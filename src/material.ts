/**
 * Compiled resources at the block level, and a material's expressions: what an item's gem colours.
 *
 * A material can set a parameter from an expression the game evaluates, such as Terrorblade's
 * `g_vDetail1ColorTint = exists($GemColor) ? $GemColor : float3(0.35, 0.74, 1.0)`, compiled to the
 * bytecode ValveResourceFormat's VfxEval.cs (MIT) reads. The arcana's red glow is its gem's colour
 * coming in that way (issue #118). Putting a constant where the expression reads `$GemColor` gives
 * the arcana the chosen colour and leaves the other branch, the hero with no gem, as it was.
 *
 * Materials come in two containers: KV3, with the expressions in binary blobs (src/kv3.ts), and
 * the older NTRO, a C struct its own NTRO block describes, where a new expression is added at the
 * end of the data and pointed to. The blocks themselves are src/resource.ts.
 */
import { readKv3, type Kv3Node } from './kv3.ts';
import { dataBlock, resourceBlocks, type Block } from './resource.ts';

/** Valve's hash of a name the expressions read (MurmurHash2 of the lowercased name, their seed). */
export function attributeToken(name: string): number {
  const d = Buffer.from(name.toLowerCase());
  const m = 0x5bd1e995;
  let h = (0x31415926 ^ d.length) >>> 0;
  let i = 0;
  for (; d.length - i >= 4; i += 4) {
    let k = Math.imul(d.readUInt32LE(i), m);
    k ^= k >>> 24;
    h = Math.imul(h, m) ^ Math.imul(k, m);
  }
  const rest = d.length - i;
  if (rest === 3) h ^= d[i + 2] << 16;
  if (rest >= 2) h ^= d[i + 1] << 8;
  if (rest >= 1) h = Math.imul(h ^ d[i], m);
  h ^= h >>> 13;
  h = Math.imul(h, m);
  return (h ^ (h >>> 15)) >>> 0;
}

/** How many operand bytes follow each opcode VfxEval.cs knows; anything else is refused. */
const OPERANDS: Record<number, number> = {
  0x00: 0, 0x02: 2, 0x04: 4, 0x06: 2, 0x07: 4, 0x08: 1, 0x09: 1,
  0x0c: 0, 0x0d: 0, 0x0e: 0, 0x0f: 0, 0x10: 0, 0x11: 0, 0x12: 0, 0x13: 0, 0x14: 0, 0x15: 0, 0x16: 0, 0x17: 0, 0x18: 0,
  0x19: 4, 0x1a: 1, 0x1d: 4, 0x1e: 1, 0x1f: 4, 0x22: 1,
};
const RETURN = 0x00;
const JUMP = 0x02;
const BRANCH = 0x04;
const FUNC = 0x06;
const FLOAT = 0x07;
const ATTRIBUTE = 0x19;
const FLOAT3 = 0x19;
const FLOAT4 = 0x18;

/** The code that puts a constant (three or four numbers) on the stack. */
const constantValue = (value: number[]) => Buffer.concat([
  ...value.map((v) => { const b = Buffer.alloc(5); b[0] = FLOAT; b.writeFloatLE(v, 1); return b; }),
  Buffer.from([FUNC, value.length === 4 ? FLOAT4 : FLOAT3, 0]),
]);

/** An expression that is a constant (three or four numbers) and nothing else. */
export function constantExpression(value: number[]): Buffer {
  return Buffer.concat([constantValue(value), Buffer.from([RETURN])]);
}

/**
 * An expression with every read of one attribute replaced by a constant (three or four numbers),
 * its jumps moved to where their targets now are.
 * @returns the new bytecode, or null when it reads no such attribute or holds an opcode not known
 */
export function withConstant(code: Buffer, token: number, value: number[]): Buffer | null {
  const ops: { at: number; bytes: Buffer }[] = [];
  for (let i = 0; i < code.length;) {
    const n = OPERANDS[code[i]];
    if (n === undefined || i + 1 + n > code.length) return null;
    ops.push({ at: i, bytes: code.subarray(i, i + 1 + n) });
    i += 1 + n;
  }
  const constant = constantValue(value);
  let found = false;
  const next = ops.map((o) => {
    if (o.bytes[0] !== ATTRIBUTE || o.bytes.readUInt32LE(1) !== token) return Buffer.from(o.bytes);
    found = true;
    return constant;
  });
  if (!found) return null;
  const moved = new Map<number, number>();
  let at = 0;
  ops.forEach((o, k) => { moved.set(o.at, at); at += next[k].length; });
  moved.set(code.length, at);
  for (const [k, o] of ops.entries()) {
    const targets = o.bytes[0] === JUMP ? [1] : o.bytes[0] === BRANCH ? [1, 3] : [];
    for (const t of targets) {
      const to = moved.get(o.bytes.readUInt16LE(t));
      if (to === undefined) return null;
      next[k].writeUInt16LE(to, t);
    }
  }
  return Buffer.concat(next);
}

/** A material parameter set by an expression: its name and bytecode. */
export interface Expression { name: string; code: Buffer }

/** The fields of the NTRO structs a material needs, by struct name. */
function ntroStructs(file: Buffer, ntro: Block): Map<string, { size: number; fields: Map<string, number> }> {
  const cstr = (at: number) => file.toString('latin1', at, file.indexOf(0, at));
  const list = ntro.at + 4 + file.readUInt32LE(ntro.at + 4);
  const byId = new Map<number, { name: string; size: number; base: number; fields: Map<string, number> }>();
  for (let i = 0; i < file.readUInt32LE(ntro.at + 8); i++) {
    const s = list + i * 40;
    const fields = new Map<string, number>();
    const fieldList = s + 28 + file.readUInt32LE(s + 28);
    for (let j = 0; j < file.readUInt32LE(s + 32); j++) {
      const q = fieldList + j * 24;
      fields.set(cstr(q + file.readUInt32LE(q)), file.readInt16LE(q + 6));
    }
    byId.set(file.readUInt32LE(s + 4), { name: cstr(s + 8 + file.readUInt32LE(s + 8)), size: file.readUInt16LE(s + 20), base: file.readUInt32LE(s + 24), fields });
  }
  const out = new Map<string, { size: number; fields: Map<string, number> }>();
  for (const s of byId.values()) {
    const fields = new Map(s.fields);
    for (let b = byId.get(s.base); b; b = byId.get(b.base)) for (const [k, v] of b.fields) if (!fields.has(k)) fields.set(k, v);
    out.set(s.name, { size: s.size, fields });
  }
  return out;
}

/**
 * Where an NTRO material keeps its dynamic parameters: for each, its name, its bytecode, and the
 * place of the bytecode's pointer and length (the pointer counts from its own position).
 */
function ntroExpressions(file: Buffer): { name: string; code: Buffer; pointer: number }[] {
  const blocks = resourceBlocks(file);
  const ntro = blocks.find((b) => b.name === 'NTRO');
  const data = blocks.find((b) => b.name === 'DATA');
  if (!ntro || !data) throw new Error('material: no NTRO or DATA block');
  const structs = ntroStructs(file, ntro);
  const root = structs.get('MaterialResourceData_t');
  const param = structs.get('MaterialParamBuffer_t');
  const list = root?.fields.get('m_dynamicParams');
  const name = param?.fields.get('m_name');
  const value = param?.fields.get('m_value');
  if (!param || list === undefined || name === undefined || value === undefined) throw new Error('material: not the struct a material has');
  const arrayAt = data.at + list;
  const first = arrayAt + file.readUInt32LE(arrayAt);
  const out: { name: string; code: Buffer; pointer: number }[] = [];
  for (let k = 0; k < file.readUInt32LE(arrayAt + 4); k++) {
    const e = first + k * param.size;
    const nameAt = e + name + file.readUInt32LE(e + name);
    const pointer = e + value;
    const codeAt = pointer + file.readUInt32LE(pointer);
    out.push({ name: file.toString('latin1', nameAt, file.indexOf(0, nameAt)), code: file.subarray(codeAt, codeAt + file.readUInt32LE(pointer + 4)), pointer });
  }
  return out;
}

const isNtro = (file: Buffer) => resourceBlocks(file).some((b) => b.name === 'NTRO');

/** A KV3 material's dynamic parameters as nodes whose blob can be given new bytes. */
function kv3Expressions(file: Buffer) {
  const kv = readKv3(dataBlock(file).data);
  const list = kv.root.kind === 'object' ? kv.root.members.get('m_dynamicParams') : undefined;
  const params = list?.kind === 'array' ? list.items : [];
  const out: { name: string; blob: Extract<Kv3Node, { kind: 'blob' }> }[] = [];
  for (const p of params) {
    if (p.kind !== 'object') continue;
    const name = p.members.get('m_name');
    const value = p.members.get('m_value');
    if (name?.kind === 'string' && value?.kind === 'blob') out.push({ name: name.value, blob: value });
  }
  return { kv, out };
}

/** A material's expressions, whichever container it is in. */
export function materialExpressions(file: Buffer): Expression[] {
  if (isNtro(file)) return ntroExpressions(file).map(({ name, code }) => ({ name, code: Buffer.from(code) }));
  return kv3Expressions(file).out.map(({ name, blob }) => ({ name, code: Buffer.from(blob.data) }));
}

/**
 * The material with some expressions rewritten (`change` returns new bytecode, or null to keep one).
 * @returns the new file and how many expressions changed
 */
export function rewriteExpressions(file: Buffer, change: (e: Expression) => Buffer | null): { file: Buffer; changed: number } {
  let changed = 0;
  if (isNtro(file)) {
    const block = dataBlock(file);
    const data = Buffer.from(block.data);
    const start = resourceBlocks(file).find((b) => b.name === 'DATA')!.at;
    const added: Buffer[] = [];
    let end = data.length;
    for (const e of ntroExpressions(file)) {
      const code = change({ name: e.name, code: Buffer.from(e.code) });
      if (!code) continue;
      // the new code goes after the data, pointed to from where the old pointer was
      const pointer = e.pointer - start;
      data.writeUInt32LE(end - pointer, pointer);
      data.writeUInt32LE(code.length, pointer + 4);
      added.push(code);
      end += code.length;
      changed++;
    }
    return { file: changed ? block.replace(Buffer.concat([data, ...added])) : file, changed };
  }
  const { kv, out } = kv3Expressions(file);
  for (const e of out) {
    const code = change({ name: e.name, code: Buffer.from(e.blob.data) });
    if (!code) continue;
    e.blob.data = code;
    changed++;
  }
  return { file: changed ? dataBlock(file).replace(kv.encode()) : file, changed };
}

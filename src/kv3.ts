/**
 * Binary KV3, the format Source 2 compiles particles and most other resources into: read far
 * enough to find every number in it, change a number where it lies, and write the block back.
 *
 * Not a general reader. Recolouring a particle (src/recolor.ts, issue #118) needs the colours and
 * nothing else, and a colour in a compiled particle is a typed array of four INT32s
 * (`m_ConstantColor = [ 0, 210, 255, 255 ]`). Those sit in a lane of fixed-width values, so a new
 * colour is the same number of bytes in the same place and nothing else in the block moves. The
 * walk still visits every value, because the lanes are read in order and a value skipped is a
 * value misplaced; reaching the end of every lane exactly is how a file this misreads gets refused
 * instead of patched.
 *
 * The layout follows ValveResourceFormat's BinaryKV3.cs (MIT), versions 1 to 5. Of the 339
 * Terrorblade particles in the game on 2026-10-08, 290 are version 2, 39 version 5, 8 version 4
 * and 2 version 3, all LZ4. Files with binary blobs are refused; no particle here has one.
 */

const MAGIC = 0x4b563300;
const LZ4 = 1;
const NONE = 0;

/** LZ4 block format: literals and back-references, the one Valve's KV3 writer uses. */
export function lz4Decode(src: Buffer, size: number): Buffer {
  const out = Buffer.alloc(size);
  let i = 0;
  let o = 0;
  const len = (n: number) => { let b; do { b = src[i++]; n += b; } while (b === 255); return n; };
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) lit = len(lit);
    src.copy(out, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const back = src[i] | (src[i + 1] << 8);
    i += 2;
    let match = token & 15;
    if (match === 15) match = len(match);
    match += 4;
    if (!back || back > o) throw new Error('kv3: LZ4 reference outside the output');
    for (let from = o - back, k = 0; k < match; k++) out[o++] = out[from++];
  }
  if (o !== size) throw new Error(`kv3: LZ4 gave ${o} bytes, expected ${size}`);
  return out;
}

/** The same bytes as one LZ4 block of literals only: valid LZ4, a little larger than the input. */
export function lz4Literals(src: Buffer): Buffer {
  const head = [src.length >= 15 ? 0xf0 : src.length << 4];
  if (src.length >= 15) {
    let rest = src.length - 15;
    for (; rest >= 255; rest -= 255) head.push(255);
    head.push(rest);
  }
  return Buffer.concat([Buffer.from(head), src]);
}

/** Where one number lives: which decompressed buffer, the byte offset in it, and how wide it is. */
export interface Kv3Cell { buffer: 0 | 1; offset: number; width: 1 | 2 | 4 | 8; signed: boolean; float?: boolean }

/**
 * A value in the tree the walk builds. A number keeps where it lies (`cell`), or null when the
 * type alone says what it is (0 and 1 written as INT64_ZERO, DOUBLE_ONE...), and where its type
 * byte is, which is the one place such a number can be changed. Elements of a typed array share
 * one type byte, so theirs is null.
 */
export type Kv3Node =
  | { kind: 'object'; members: Map<string, Kv3Node> }
  | { kind: 'array'; items: Kv3Node[] }
  | { kind: 'number'; type: number; cell: Kv3Cell | null; typeAt: Kv3Cell | null }
  | { kind: 'string'; value: string }
  | { kind: 'other' };

/** An array of numbers the walk found, with the member name it was under and a cell per element (null: no storage). */
export interface Kv3Array { key: string; path: string; cells: (Kv3Cell | null)[] }

/** A parsed block: its decompressed buffers, its tree, the arrays of numbers in it, and how to put it back together. */
export interface Kv3Block {
  version: number;
  buffers: Buffer[];
  root: Kv3Node;
  arrays: Kv3Array[];
  /** the block with the buffers as they are now, compressed the way it came */
  encode(): Buffer;
}


interface Lane { buf: 0 | 1; at: number; end: number }
const lane = (buf: 0 | 1, at: number, size: number): Lane => ({ buf, at, end: at + size });
const align = (n: number, a: number) => (n + a - 1) & ~(a - 1);

/** Read a KV3 block (a resource's DATA block, magic included). */
export function readKv3(block: Buffer): Kv3Block {
  const magic = block.readUInt32LE(0);
  const version = magic & 0xff;
  if ((magic & 0xffffff00) >>> 0 !== MAGIC || version < 1 || version > 5) throw new Error('kv3: not a binary KV3 block');
  let p = 20;
  const method = block.readUInt32LE(p); p += 4;
  if (method !== LZ4 && method !== NONE) throw new Error(`kv3: compression ${method} is not handled`);
  const h: Record<string, number> = {};
  const field = (name: string, w: 2 | 4) => { h[name] = w === 2 ? block.readUInt16LE(p) : block.readInt32LE(p); h[`@${name}`] = p; p += w; };
  if (version === 1) {
    for (const f of ['c1', 'c4', 'c8', 'unc']) field(f, 4);
  } else {
    field('dict', 2); field('frame', 2);
    for (const f of ['c1', 'c4', 'c8', 'types']) field(f, 4);
    field('objects', 2); field('arraysN', 2);
    for (const f of ['unc', 'cmp', 'blocks', 'blobs']) field(f, 4);
  }
  if (version >= 4) { field('c2', 4); field('blockSizes', 4); }
  if (version >= 5) for (const f of ['unc1', 'cmp1', 'unc2', 'cmp2', 'b2c1', 'b2c2', 'b2c4', 'b2c8', 'nodes', 'b2objects', 'b2arrays', 'elements']) field(f, 4);
  if (h.blocks) throw new Error('kv3: binary blobs are not handled');
  const headerEnd = p;

  const unpack = (size: number, csize: number): Buffer => {
    const src = block.subarray(p, p + (method === NONE ? size : csize));
    p += src.length;
    return method === NONE ? Buffer.from(src) : lz4Decode(src, size);
  };
  const buffers = version >= 5
    ? [unpack(h.unc1, h.cmp1), unpack(h.unc2, h.cmp2)]
    : [unpack(h.unc, version === 1 ? block.length - headerEnd : h.cmp)];
  const tail = block.subarray(p);

  // the lanes of the first buffer: 1-byte, 2-byte, 4-byte (string count first), 8-byte
  const b0 = buffers[0];
  let off = 0;
  const l1 = lane(0, off, h.c1); off += h.c1;
  let l2 = lane(0, off, 0);
  if (h.c2) { off = align(off, 2); l2 = lane(0, off, h.c2 * 2); off = l2.end; }
  off = align(off, 4); const l4 = lane(0, off, h.c4 * 4); off = l4.end;
  off = align(off, 8); const l8 = lane(0, off, h.c8 * 8); off = l8.end;
  const strings: string[] = [];
  const nStrings = b0.readInt32LE(l4.at);
  l4.at += 4;
  const text = version >= 5 ? l1 : { at: off };
  for (let s = 0; s < nStrings; s++) {
    const z = b0.indexOf(0, text.at);
    strings.push(b0.toString('utf8', text.at, z));
    text.at = z + 1;
  }

  // the main lanes and the types: in the same buffer before v5, in the second from v5
  let main = { l1, l2, l4, l8 };
  const aux = main;
  let types: Lane;
  let objectLengths: Lane | null = null;
  if (version >= 5) {
    const b1 = buffers[1];
    objectLengths = lane(1, 0, h.b2objects * 4);
    let q = objectLengths.end;
    const m1 = lane(1, q, h.b2c1); q = m1.end;
    let m2 = lane(1, q, 0);
    if (h.b2c2) { q = align(q, 2); m2 = lane(1, q, h.b2c2 * 2); q = m2.end; }
    if (h.b2c4) q = align(q, 4);
    const m4 = lane(1, q, h.b2c4 * 4); q = m4.end;
    if (h.b2c8) q = align(q, 8);
    const m8 = lane(1, q, h.b2c8 * 8); q = m8.end;
    main = { l1: m1, l2: m2, l4: m4, l8: m8 };
    types = lane(1, q, h.types);
    if (b1.readUInt32LE(types.end) !== 0xffeedd00) throw new Error('kv3: no trailer after the types');
  } else {
    const typesLength = version === 1 ? b0.length - text.at - 4 : h.types - (text.at - off);
    types = lane(0, text.at, typesLength);
    if (b0.readUInt32LE(types.end) !== 0xffeedd00) throw new Error('kv3: no trailer after the types');
  }

  const buf = (l: Lane) => buffers[l.buf];
  const take = (l: Lane, width: number): number => { const at = l.at; l.at += width; if (l.at > l.end) throw new Error('kv3: a lane ran out'); return at; };
  const cell = (l: Lane, width: 1 | 2 | 4 | 8, signed: boolean, float = false): Kv3Cell => ({ buffer: l.buf, offset: take(l, width), width, signed, ...(float ? { float } : {}) });
  /** the next type, and where its byte is */
  const readType = (): [number, Kv3Cell] => {
    const at: Kv3Cell = { buffer: types.buf, offset: types.at, width: 1, signed: false };
    let t = buf(types)[take(types, 1)];
    if (version >= 3) {
      if (t & 0x80) take(types, 1);
      if (t & 0x40) take(types, 1);
      t &= 0x3f;
    } else {
      if (t & 0x80) take(types, 1);
      t &= 0x7f;
    }
    return [t, at];
  };
  const int4 = (l: Lane) => buf(l).readInt32LE(take(l, 4));
  const arrays: Kv3Array[] = [];
  const num = (type: number, c: Kv3Cell | null, typeAt: Kv3Cell | null): Kv3Node => ({ kind: 'number', type, cell: c, typeAt });

  const value = (t: number, typeAt: Kv3Cell | null, lanes: typeof main, key: string, path: string): Kv3Node => {
    switch (t) {
      case 15: case 16: case 17: case 18: return num(t, null, typeAt); // 0 or 1, stored in the type alone
      case 1: case 13: case 14: return { kind: 'other' };
      case 2: take(lanes.l1, 1); return { kind: 'other' };
      case 22: case 23: return num(t, cell(lanes.l1, 1, t === 22), typeAt);
      case 20: case 21: return num(t, cell(lanes.l2, 2, t === 20), typeAt);
      case 11: case 12: return num(t, cell(lanes.l4, 4, t === 11), typeAt);
      case 19: return num(t, cell(lanes.l4, 4, true, true), typeAt);
      case 3: case 4: return num(t, cell(lanes.l8, 8, t === 3), typeAt);
      case 5: return num(t, cell(lanes.l8, 8, true, true), typeAt);
      case 6: return { kind: 'string', value: strings[int4(main.l4)] ?? '' };
      case 8: case 10: case 24: case 25: {
        const n = t === 8 || t === 10 ? int4(main.l4) : buf(main.l1)[take(main.l1, 1)];
        const items: Kv3Node[] = [];
        if (t === 8) {
          for (let k = 0; k < n; k++) { const [et, eat] = readType(); items.push(value(et, eat, main, key, `${path}[${k}]`)); }
        } else {
          const [sub] = readType();
          const elementLanes = t === 25 ? aux : main;
          for (let k = 0; k < n; k++) items.push(value(sub, null, elementLanes, key, `${path}[${k}]`));
        }
        if (items.every((x) => x.kind === 'number')) arrays.push({ key, path, cells: items.map((x) => (x as { cell: Kv3Cell | null }).cell) });
        return { kind: 'array', items };
      }
      case 9: {
        const n = objectLengths ? int4(objectLengths) : int4(main.l4);
        const members = new Map<string, Kv3Node>();
        for (let k = 0; k < n; k++) {
          const [ty, tat] = readType();
          const name = strings[int4(main.l4)] ?? '';
          members.set(name, value(ty, tat, main, name, `${path}.${name}`));
        }
        return { kind: 'object', members };
      }
      default: throw new Error(`kv3: value type ${t} at ${path || 'the root'}`);
    }
  };
  const [rootType, rootAt] = readType();
  const root = value(rootType, rootAt, main, '', '');
  const lanes = version >= 5 ? [main.l1, main.l2, main.l4, main.l8, types, aux.l1, aux.l2, aux.l4, aux.l8] : [main.l1, main.l2, main.l4, main.l8, types];
  for (const l of lanes) if (l.at !== l.end) throw new Error('kv3: the walk did not end where the data does');

  return {
    version,
    buffers,
    root,
    arrays,
    encode() {
      const head = Buffer.from(block.subarray(0, headerEnd));
      const packed = buffers.map((b) => (method === LZ4 ? lz4Literals(b) : b));
      if (method === LZ4) {
        if (version >= 5) {
          head.writeInt32LE(packed[0].length, h['@cmp1']);
          head.writeInt32LE(packed[1].length, h['@cmp2']);
          head.writeInt32LE(packed[0].length + packed[1].length, h['@cmp']);
        } else if (version > 1) {
          head.writeInt32LE(packed[0].length, h['@cmp']);
        }
      }
      return Buffer.concat([head, ...packed, tail]);
    },
  };
}

/** A number's value. */
export function readCell(kv: Kv3Block, c: Kv3Cell): number {
  const b = kv.buffers[c.buffer];
  if (c.float) return c.width === 4 ? b.readFloatLE(c.offset) : b.readDoubleLE(c.offset);
  if (c.width === 1) return c.signed ? b.readInt8(c.offset) : b.readUInt8(c.offset);
  if (c.width === 2) return c.signed ? b.readInt16LE(c.offset) : b.readUInt16LE(c.offset);
  if (c.width === 4) return c.signed ? b.readInt32LE(c.offset) : b.readUInt32LE(c.offset);
  return Number(c.signed ? b.readBigInt64LE(c.offset) : b.readBigUInt64LE(c.offset));
}

/** Change a number where it lies. */
export function writeCell(kv: Kv3Block, c: Kv3Cell, v: number): void {
  const b = kv.buffers[c.buffer];
  if (c.float) { if (c.width === 4) b.writeFloatLE(v, c.offset); else b.writeDoubleLE(v, c.offset); return; }
  if (c.width === 1) { if (c.signed) b.writeInt8(v, c.offset); else b.writeUInt8(v, c.offset); return; }
  if (c.width === 2) { if (c.signed) b.writeInt16LE(v, c.offset); else b.writeUInt16LE(v, c.offset); return; }
  if (c.width === 4) { if (c.signed) b.writeInt32LE(v, c.offset); else b.writeUInt32LE(v, c.offset); return; }
  if (c.signed) b.writeBigInt64LE(BigInt(v), c.offset); else b.writeBigUInt64LE(BigInt(v), c.offset);
}

/** A number node's value: from its bytes, or from its type for the 0s and 1s stored as a type alone. */
export function numberOf(kv: Kv3Block, node: Extract<Kv3Node, { kind: 'number' }>): number {
  if (node.cell) return readCell(kv, node.cell);
  return node.type === 16 || node.type === 18 ? 1 : 0;
}

/**
 * Set a number node where it lies. A number with bytes takes any value its width holds; one stored
 * as a type alone can only turn into the other of 0 and 1, by rewriting that type byte, which keeps
 * every lane the length it was.
 * @returns whether the value could be set
 */
export function setNumber(kv: Kv3Block, node: Extract<Kv3Node, { kind: 'number' }>, v: number): boolean {
  if (node.cell) { writeCell(kv, node.cell, v); return true; }
  if (!node.typeAt || (v !== 0 && v !== 1)) return false;
  const want = node.type <= 16 ? (v ? 16 : 15) : (v ? 18 : 17);
  const b = kv.buffers[node.typeAt.buffer];
  const mask = kv.version >= 3 ? 0x3f : 0x7f;
  b[node.typeAt.offset] = (b[node.typeAt.offset] & ~mask) | want;
  node.type = want;
  return true;
}

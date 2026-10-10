/* Valve's compiled files built by hand, for tests of the code that reads and writes them
 * (src/kv3.ts, src/kv3-write.ts, src/resource.ts, src/material.ts, src/recolor.ts, src/arcana.ts):
 * binary KV3 blocks of versions 1 and 2 with the shapes the real ones have, and resources with
 * their blocks in the order the game writes them. Valve's own files cannot be committed here.
 */
import { lz4Literals } from '../../src/lz4.ts';
import { readCell, type Kv3Block, type Kv3Node } from '../../src/kv3.ts';
import { resourceId } from '../../src/resource.ts';

/** A value as the test writes it, one key per KV3 type the encoder below knows. */
export type V = { int: number } | { i32s: number[] } | { str: string } | { yes: true } | { one: true } | { dbl: number }
  | { i64: number } | { i64zero: true } | { f64s: number[] } | { blob: Buffer } | { obj: [string, V][] } | { arr: V[] }
  | { ref: string } | { bool: boolean };

const TRAILER = 0xffeedd00;
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const pad = (n: number, a: number) => Buffer.alloc((a - (n % a)) % a);

/**
 * A binary KV3 block, LZ4. Version 2 is the shape 290 of the game's Terrorblade particles have,
 * blobs in frames after the buffer; version 1 keeps a blob in the 1-byte lane.
 */
export function encodeKv3(root: V, version: 1 | 2 = 2): Buffer {
  const strings: string[] = [];
  const sid = (x: string) => { let i = strings.indexOf(x); if (i < 0) { i = strings.length; strings.push(x); } return i; };
  const l1: Buffer[] = [];
  const l4: number[] = [];
  const l8: [number, boolean][] = []; // value, and whether it is a double
  const types: number[] = [];
  const blobs: Buffer[] = [];
  const typeOf = (v: V): number => ('int' in v ? 11 : 'i32s' in v ? 10 : 'str' in v ? 6 : 'yes' in v ? 13 : 'one' in v ? 18 : 'dbl' in v ? 5
    : 'i64' in v ? 3 : 'i64zero' in v ? 15 : 'f64s' in v ? 10 : 'blob' in v ? 7 : 'obj' in v ? 9 : 'ref' in v ? 6 : 'bool' in v ? 2 : 8);
  // a string that names a resource carries a flag after its type (bit 1 before version 3)
  const typed = (v: V) => ('ref' in v ? types.push(6 | 0x80, 1) : types.push(typeOf(v)));
  const body = (v: V): void => {
    if ('int' in v) l4.push(v.int);
    else if ('i32s' in v) { l4.push(v.i32s.length); types.push(11); l4.push(...v.i32s); }
    else if ('f64s' in v) { l4.push(v.f64s.length); types.push(5); l8.push(...v.f64s.map((x): [number, boolean] => [x, true])); }
    else if ('str' in v) l4.push(sid(v.str));
    else if ('ref' in v) l4.push(sid(v.ref));
    else if ('bool' in v) l1.push(Buffer.from([v.bool ? 1 : 0]));
    else if ('dbl' in v) l8.push([v.dbl, true]);
    else if ('i64' in v) l8.push([v.i64, false]);
    else if ('blob' in v) { if (version === 1) { l4.push(v.blob.length); l1.push(v.blob); } else blobs.push(v.blob); }
    else if ('obj' in v) { l4.push(v.obj.length); for (const [k, x] of v.obj) { typed(x); l4.push(sid(k)); body(x); } }
    else if ('arr' in v) { l4.push(v.arr.length); for (const x of v.arr) { typed(x); body(x); } }
  };
  typed(root);
  body(root);
  const ones = Buffer.concat(l1);
  const ints = [strings.length, ...l4];
  const b4 = Buffer.alloc(ints.length * 4);
  ints.forEach((n, i) => b4.writeInt32LE(n, i * 4));
  const b8 = Buffer.alloc(l8.length * 8);
  l8.forEach(([n, dbl], i) => (dbl ? b8.writeDoubleLE(n, i * 8) : b8.writeBigInt64LE(BigInt(n), i * 8)));
  const text = Buffer.from(strings.map((x) => `${x}\0`).join(''));
  const frames = blobs.map(lz4Literals);
  const blobTable = blobs.length
    ? Buffer.concat([...blobs.map((b) => u32(b.length)), u32(TRAILER), ...frames.map((f) => { const s = Buffer.alloc(2); s.writeUInt16LE(f.length); return s; })])
    : u32(TRAILER);
  const before4 = Buffer.concat([ones, pad(ones.length, 4), b4]);
  const raw = Buffer.concat([before4, pad(before4.length, 8), b8, text, Buffer.from(types), blobTable]);
  const packed = lz4Literals(raw);
  if (version === 1) {
    const head = Buffer.alloc(40);
    head.writeUInt32LE(0x4b563301, 0);
    head.writeUInt32LE(1, 20); // LZ4
    head.writeInt32LE(ones.length, 24); head.writeInt32LE(ints.length, 28); head.writeInt32LE(l8.length, 32); head.writeInt32LE(raw.length, 36);
    return Buffer.concat([head, packed]);
  }
  const head = Buffer.alloc(64);
  head.writeUInt32LE(0x4b563302, 0);
  head.writeUInt32LE(1, 20); // LZ4
  head.writeUInt16LE(16384, 26);
  head.writeInt32LE(ones.length, 28); head.writeInt32LE(ints.length, 32); head.writeInt32LE(l8.length, 36);
  head.writeInt32LE(text.length + types.length, 40);
  head.writeInt32LE(raw.length, 48); head.writeInt32LE(packed.length, 52);
  head.writeInt32LE(blobs.length, 56); head.writeInt32LE(blobs.reduce((a, b) => a + b.length, 0), 60);
  return Buffer.concat([head, packed, ...(blobs.length ? [...frames, u32(TRAILER)] : [])]);
}

/** A particle: a colour, an integer and a switch beside it, and a colour whose zero has no bytes. */
export function kv3Block(color: number[] = [0, 210, 255, 255]): Buffer {
  return encodeKv3({ obj: [
    ['m_ConstantColor', { i32s: color }],
    ['m_nMaxParticles', { int: 500 }],
    ['m_bSaturateColorPreAlphaBlend', { yes: true }],
    ['m_ColorMin', { arr: [{ i64zero: true }, { i64: 210 }, { i64: 255 }] }],
  ] });
}

/** An operator that colours a particle from a control point, into the range [0, outMax]. */
export const remap = (cp: number, outMax: number[] = [1, 1, 1]): V => ({ obj: [
  ['_class', { str: 'C_INIT_RemapCPtoVector' }],
  ['m_nCPInput', { int: cp }],
  ['m_nFieldOutput', { int: 6 }],
  ['m_vInputMax', { f64s: [255, 255, 255] }],
  ['m_vOutputMax', { f64s: outMax }],
  ['m_flOpStrength', { obj: [['m_nType', { str: 'PF_TYPE_CONTROL_POINT_COMPONENT' }], ['m_flOutput1', { one: true }]] }],
] });

/** A compiled resource: the blocks in the order given, each 16-byte aligned like the game's. */
export function resource(blocks: [string, Buffer][]): Buffer {
  const head = Buffer.alloc(16 + blocks.length * 12);
  head.writeUInt16LE(12, 4);
  head.writeUInt32LE(8, 8);
  head.writeUInt32LE(blocks.length, 12);
  const parts: Buffer[] = [head];
  let at = head.length;
  blocks.forEach(([name, data], k) => {
    const gap = pad(at, 16);
    parts.push(gap, data);
    at += gap.length;
    const e = 16 + k * 12;
    head.write(name, e, 'ascii');
    head.writeUInt32LE(at - (e + 4), e + 4);
    head.writeUInt32LE(data.length, e + 8);
    at += data.length;
  });
  const out = Buffer.concat(parts);
  out.writeUInt32LE(out.length, 0);
  return out;
}

export const particle = (data: Buffer) => resource([['RERL', Buffer.from('references')], ['DATA', data]]);

/** A member of an object node, by a path of names and array indexes. */
export function at(node: Kv3Node, ...p: (string | number)[]): Kv3Node {
  let n = node;
  for (const k of p) n = typeof k === 'number' ? (n as Extract<Kv3Node, { kind: 'array' }>).items[k] : (n as Extract<Kv3Node, { kind: 'object' }>).members.get(k)!;
  return n;
}
export const range = (kv: Kv3Block, n: Kv3Node) => (n as Extract<Kv3Node, { kind: 'array' }>).items.map((x) => +readCell(kv, (x as { cell: NonNullable<Parameters<typeof readCell>[1]> }).cell).toFixed(3));

/** A RERL block naming `paths`. */
export function rerl(paths: string[]): Buffer {
  const head = Buffer.alloc(8 + paths.length * 16);
  head.writeUInt32LE(8, 0);
  head.writeUInt32LE(paths.length, 4);
  let text = head.length;
  paths.forEach((p, k) => {
    const e = 8 + k * 16;
    head.writeBigUInt64LE(resourceId(p), e);
    head.writeUInt32LE(text - (e + 8), e + 8);
    text += p.length + 1;
  });
  return Buffer.concat([head, ...paths.map((p) => Buffer.from(`${p}\0`))]);
}

/**
 * A particle with children, named in RERL, the way the arcana's eyes are: it binds a control point
 * to an attachment per child and hands point k to child k.
 */
export const host = (children = ['particles/eye.vpcf']) => resource([
  ['RERL', rerl(children)],
  ['DATA', encodeKv3({ obj: [
    ['m_ConstantColor', { i32s: [0, 210, 255, 255] }],
    ['m_Children', { arr: children.map((c): V => ({ obj: [['m_ChildRef', { ref: c }], ['m_flDelay', { dbl: 0.5 }]] })) }],
    ['m_controlPointConfigurations', { arr: [{ obj: [['m_name', { str: 'preview' }], ['m_drivers', { arr: children.map((_, k): V => ({ obj: [
      ...(k ? [['m_iControlPoint', { int: k }] as [string, V]] : []),
      ['m_iAttachType', { str: 'PATTACH_POINT_FOLLOW' }], ['m_entityName', { str: 'parent' }], ['m_attachmentName', { str: `attach_${k}` }],
    ] })) }]] }] }],
    ['m_PreEmissionOperators', { arr: [{ obj: [['_class', { str: 'C_OP_SetParentControlPointsToChildCP' }], ['m_nNumControlPoints', { int: children.length }]] }] }],
  ] })],
]);

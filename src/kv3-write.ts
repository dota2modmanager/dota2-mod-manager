/**
 * A KV3 block written anew from its tree (src/kv3.ts), for changes that are more than a number:
 * a member or an array element added, a string of another length. Numbers are copied as the bytes
 * they were, so nothing is rounded on the way.
 *
 * The block comes out in one buffer, the layout of versions 2 to 4: a file read as version 1 or 2
 * is written as 2, 3 as 3, 4 and 5 as 4, so a type's flag byte means what it meant (versions 1 and
 * 2 keep flags as bits, 3 and later as one value). Typed arrays are all written as ARRAY_TYPED,
 * which every version reads; an empty one, and one of arrays or objects, as a plain array.
 */
import type { Kv3Block, Kv3Node } from './kv3.ts';
import { lz4Literals } from './lz4.ts';

const TRAILER = 0xffeedd00;
const FRAME = 16384;

/** Bytes gathered one value at a time. */
class Lane {
  parts: Buffer[] = [];
  length = 0;
  push(b: Buffer) { this.parts.push(b); this.length += b.length; }
  bytes() { return Buffer.concat(this.parts); }
}

const int32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const padTo = (n: number, a: number) => Buffer.alloc((a - (n % a)) % a);

/** Arrays and objects: as the element type of a typed array, each of them has a shape of its own. */
const CONTAINERS = new Set([8, 9, 10, 24, 25]);

/**
 * The type a node is written under in its slot. A typed array of containers goes as a plain array,
 * each element with its own type: a model's typed array of byte-length arrays (24) came back
 * misread when its elements were written in another array's shape under the type it had.
 */
function slotType(n: Kv3Node): number {
  switch (n.kind) {
    case 'object': return 9;
    case 'array': return n.element && n.items.length && !CONTAINERS.has(n.element.type) ? 10 : 8;
    case 'string': return 6;
    case 'blob': return 7;
    default: return n.type;
  }
}

/** The block, written from `kv.root`, with the source's format GUID. */
export function writeKv3(kv: Kv3Block): Buffer {
  const version = kv.version <= 2 ? 2 : kv.version === 3 ? 3 : 4;
  const strings: string[] = [];
  const ids = new Map<string, number>();
  const sid = (s: string) => {
    if (s === '') return -1;
    let i = ids.get(s);
    if (i === undefined) { i = strings.length; strings.push(s); ids.set(s, i); }
    return i;
  };
  const l1 = new Lane();
  const l2 = new Lane();
  const l4 = new Lane();
  const l8 = new Lane();
  const types: number[] = [];
  const blobs: Buffer[] = [];
  let objects = 0;
  let arrays = 0;
  const type = (t: number, flag?: number) => (flag ? types.push(t | 0x80, flag) : types.push(t));

  const write = (n: Kv3Node): void => {
    switch (n.kind) {
      case 'number': {
        const raw = n.raw ?? (n.cell && kv.buffers[n.cell.buffer].subarray(n.cell.offset, n.cell.offset + n.cell.width));
        if (raw) ({ 1: l1, 2: l2, 4: l4, 8: l8 } as Record<number, Lane>)[raw.length].push(Buffer.from(raw));
        return;
      }
      case 'other': if (n.type === 2) l1.push(Buffer.from([n.value ?? 0])); return;
      case 'string': l4.push(int32(sid(n.value))); return;
      case 'blob': blobs.push(n.data); return;
      case 'array': {
        arrays++;
        l4.push(int32(n.items.length));
        if (slotType(n) === 10) {
          type(n.element!.type, n.element!.flag);
          n.items.forEach(write);
        } else for (const x of n.items) { type(slotType(x), x.flag); write(x); }
        return;
      }
      case 'object': {
        objects++;
        l4.push(int32(n.members.size));
        for (const [name, x] of n.members) { type(slotType(x), x.flag); l4.push(int32(sid(name))); write(x); }
      }
    }
  };
  type(slotType(kv.root), kv.root.flag);
  write(kv.root);

  const text = Buffer.from(strings.map((s) => `${s}\0`).join(''));
  const typeBytes = Buffer.from(types);
  const chunks: Buffer[] = [];
  for (const b of blobs) for (let at = 0; at < b.length; at += FRAME) chunks.push(lz4Literals(b.subarray(at, at + FRAME)));
  const tail = blobs.length
    ? Buffer.concat([...blobs.map((b) => int32(b.length)), int32(TRAILER | 0), ...chunks.map((c) => { const s = Buffer.alloc(2); s.writeUInt16LE(c.length); return s; })])
    : int32(TRAILER | 0);
  const parts: Buffer[] = [l1.bytes()];
  let at = l1.length;
  const place = (b: Buffer, a: number) => { const pad = padTo(at, a); parts.push(pad, b); at += pad.length + b.length; };
  if (version >= 4) place(l2.bytes(), 2);
  place(Buffer.concat([int32(strings.length), l4.bytes()]), 4);
  place(l8.bytes(), 8);
  parts.push(text, typeBytes, tail);
  const raw = Buffer.concat(parts);
  const packed = lz4Literals(raw);

  const head = Buffer.alloc(version >= 4 ? 72 : 64);
  head.writeUInt32LE(0x4b563300 + version, 0);
  kv.format.copy(head, 4);
  head.writeUInt32LE(1, 20); // LZ4
  head.writeUInt16LE(FRAME, 26);
  head.writeInt32LE(l1.length, 28);
  head.writeInt32LE(1 + l4.length / 4, 32);
  head.writeInt32LE(l8.length / 8, 36);
  head.writeInt32LE(text.length + typeBytes.length, 40);
  head.writeUInt16LE(objects, 44);
  head.writeUInt16LE(arrays, 46);
  head.writeInt32LE(raw.length, 48);
  head.writeInt32LE(packed.length, 52);
  head.writeInt32LE(blobs.length, 56);
  head.writeInt32LE(blobs.reduce((a, b) => a + b.length, 0), 60);
  if (version >= 4) head.writeInt32LE(l2.length / 2, 64); // and 0 for the size of the frame table, as Valve's version 4 files have
  const trailer = int32(TRAILER | 0);
  return Buffer.concat([head, packed, ...(blobs.length ? [...chunks, trailer] : [])]);
}

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
 * and 2 version 3, all LZ4. Materials keep their expressions (`$GemColor`, issue #118) in binary
 * blobs, which can be given new bytes of another length (src/kv3-blobs.ts). The compression is
 * src/lz4.ts, reading and changing a number src/kv3-cells.ts.
 */

import { lz4Decode, lz4Literals } from './lz4.ts';
import { blobTable, readBlobs, rewriteBlobs, relaidInline } from './kv3-blobs.ts';

export { readCell, writeCell, numberOf, setNumber } from './kv3-cells.ts';

const MAGIC = 0x4b563300;
const LZ4 = 1;
const NONE = 0;

/** Where one number lives: which decompressed buffer, the byte offset in it, and how wide it is. */
export interface Kv3Cell { buffer: 0 | 1; offset: number; width: 1 | 2 | 4 | 8; signed: boolean; float?: boolean }

/**
 * A value in the tree the walk builds. A number keeps where it lies (`cell`), or null when the
 * type alone says what it is (0 and 1 written as INT64_ZERO, DOUBLE_ONE...), and where its type
 * byte is, which is the one place such a number can be changed. Elements of a typed array share
 * one type byte, so theirs is null; the array keeps that type as `element`. `flag` is the byte
 * that can follow a type (a string that names a resource, for one), kept as the file had it.
 */
export type Kv3Node = (
  | { kind: 'object'; members: Map<string, Kv3Node> }
  | { kind: 'array'; items: Kv3Node[]; element?: { type: number; flag?: number } }
  | { kind: 'number'; type: number; cell: Kv3Cell | null; typeAt: Kv3Cell | null }
  | { kind: 'string'; value: string }
  | { kind: 'blob'; data: Buffer }
  | { kind: 'other'; type: number; value?: number }
) & { flag?: number };

/** An array of numbers the walk found, with the member name it was under and a cell per element (null: no storage). */
export interface Kv3Array { key: string; path: string; cells: (Kv3Cell | null)[] }

/** A parsed block: its decompressed buffers, its tree, the arrays of numbers in it, and how to put it back together. */
export interface Kv3Block {
  version: number;
  /** the 16 bytes after the magic that name the format */
  format: Buffer;
  buffers: Buffer[];
  root: Kv3Node;
  arrays: Kv3Array[];
  /** the blob nodes, in the order they are stored; give one new `data` and encode() writes it */
  blobs: Extract<Kv3Node, { kind: 'blob' }>[];
  /** the block with the buffers and blobs as they are now, compressed the way it came */
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
  if (h.dict) throw new Error('kv3: a compression dictionary is not handled');
  const headerEnd = p;

  const unpack = (size: number, csize: number): Buffer => {
    const src = block.subarray(p, p + (method === NONE ? size : csize));
    p += src.length;
    return method === NONE ? Buffer.from(src) : lz4Decode(src, size);
  };
  const buffers = version >= 5
    ? [unpack(h.unc1, h.cmp1), unpack(h.unc2, h.cmp2)]
    : [unpack(h.unc, version === 1 ? block.length - headerEnd : h.cmp)];
  const blobsAt = p;

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
  } else {
    const typesLength = version === 1 ? b0.length - text.at - 4 : h.types - (text.at - off);
    types = lane(0, text.at, typesLength);
  }

  // binary blobs from version 2: described after the types, their frames after the buffers
  const typesBuf = buffers[types.buf];
  const table = blobTable(typesBuf, types.end, version >= 2 ? h.blocks : 0, method === LZ4, h.frame);
  const blobLengths = table ? lane(types.buf, table.lengthsAt, table.count * 4) : null;
  let blobData: Buffer = Buffer.alloc(0);
  p = blobsAt;
  if (table) ({ data: blobData, end: p } = readBlobs(block, p, table, h.blobs));
  const blobsEnd = p;
  const tail = block.subarray(p);

  const buf = (l: Lane) => buffers[l.buf];
  const take = (l: Lane, width: number): number => { const at = l.at; l.at += width; if (l.at > l.end) throw new Error('kv3: a lane ran out'); return at; };
  const cell = (l: Lane, width: 1 | 2 | 4 | 8, signed: boolean, float = false): Kv3Cell => ({ buffer: l.buf, offset: take(l, width), width, signed, ...(float ? { float } : {}) });
  /** the next type, where its byte is, and the flag after it (0: none) */
  const readType = (): [number, Kv3Cell, number] => {
    const at: Kv3Cell = { buffer: types.buf, offset: types.at, width: 1, signed: false };
    let t = buf(types)[take(types, 1)];
    const flag = t & 0x80 ? buf(types)[take(types, 1)] : 0;
    if (version >= 3) {
      if (t & 0x40) take(types, 1); // no known writer sets this; readers skip the byte after it
      t &= 0x3f;
    } else t &= 0x7f;
    return [t, at, flag];
  };
  const int4 = (l: Lane) => buf(l).readInt32LE(take(l, 4));
  const arrays: Kv3Array[] = [];
  const blobs: Extract<Kv3Node, { kind: 'blob' }>[] = [];
  const originals: Buffer[] = [];
  /** before version 2: where each blob's bytes and its length lie in the first buffer */
  const inline: { at: number; lengthAt: number }[] = [];
  let blobRead = 0;
  const num = (type: number, c: Kv3Cell | null, typeAt: Kv3Cell | null): Kv3Node => ({ kind: 'number', type, cell: c, typeAt });

  const value = (t: number, typeAt: Kv3Cell | null, lanes: typeof main, key: string, path: string, flag = 0): Kv3Node => {
    const node = read(t, typeAt, lanes, key, path);
    if (flag) node.flag = flag;
    return node;
  };
  const read = (t: number, typeAt: Kv3Cell | null, lanes: typeof main, key: string, path: string): Kv3Node => {
    switch (t) {
      case 15: case 16: case 17: case 18: return num(t, null, typeAt); // 0 or 1, stored in the type alone
      case 1: case 13: case 14: return { kind: 'other', type: t };
      case 2: return { kind: 'other', type: t, value: buf(lanes.l1)[take(lanes.l1, 1)] };
      case 22: case 23: return num(t, cell(lanes.l1, 1, t === 22), typeAt);
      case 20: case 21: return num(t, cell(lanes.l2, 2, t === 20), typeAt);
      case 11: case 12: return num(t, cell(lanes.l4, 4, t === 11), typeAt);
      case 19: return num(t, cell(lanes.l4, 4, true, true), typeAt);
      case 3: case 4: return num(t, cell(lanes.l8, 8, t === 3), typeAt);
      case 5: return num(t, cell(lanes.l8, 8, true, true), typeAt);
      case 6: return { kind: 'string', value: strings[int4(main.l4)] ?? '' };
      case 7: {
        let data: Buffer;
        if (version < 2) {
          const n = int4(main.l4);
          const at = take(main.l1, n);
          data = Buffer.from(buf(main.l1).subarray(at, at + n));
          inline.push({ at, lengthAt: main.l4.at - 4 });
        } else {
          if (!blobLengths) throw new Error('kv3: a blob with no blob table');
          const n = typesBuf.readInt32LE(take(blobLengths, 4));
          data = Buffer.from(blobData.subarray(blobRead, blobRead + n));
          blobRead += n;
        }
        const node = { kind: 'blob' as const, data };
        blobs.push(node);
        originals.push(data);
        return node;
      }
      case 8: case 10: case 24: case 25: {
        const n = t === 8 || t === 10 ? int4(main.l4) : buf(main.l1)[take(main.l1, 1)];
        const items: Kv3Node[] = [];
        let element: { type: number; flag?: number } | undefined;
        if (t === 8) {
          for (let k = 0; k < n; k++) { const [et, eat, ef] = readType(); items.push(value(et, eat, main, key, `${path}[${k}]`, ef)); }
        } else {
          const [sub, , sf] = readType();
          element = sf ? { type: sub, flag: sf } : { type: sub };
          const elementLanes = t === 25 ? aux : main;
          for (let k = 0; k < n; k++) items.push(value(sub, null, elementLanes, key, `${path}[${k}]`));
        }
        if (items.every((x) => x.kind === 'number')) arrays.push({ key, path, cells: items.map((x) => (x as { cell: Kv3Cell | null }).cell) });
        return element ? { kind: 'array', items, element } : { kind: 'array', items };
      }
      case 9: {
        const n = objectLengths ? int4(objectLengths) : int4(main.l4);
        const members = new Map<string, Kv3Node>();
        for (let k = 0; k < n; k++) {
          const [ty, tat, tf] = readType();
          const name = strings[int4(main.l4)] ?? '';
          members.set(name, value(ty, tat, main, name, `${path}.${name}`, tf));
        }
        return { kind: 'object', members };
      }
      default: throw new Error(`kv3: value type ${t} at ${path || 'the root'}`);
    }
  };
  const [rootType, rootAt, rootFlag] = readType();
  const root = value(rootType, rootAt, main, '', '', rootFlag);
  const lanes = version >= 5 ? [main.l1, main.l2, main.l4, main.l8, types, aux.l1, aux.l2, aux.l4, aux.l8] : [main.l1, main.l2, main.l4, main.l8, types];
  if (blobLengths) lanes.push(blobLengths);
  for (const l of lanes) if (l.at !== l.end) throw new Error('kv3: the walk did not end where the data does');
  if (blobRead !== blobData.length) throw new Error('kv3: blob bytes left over');

  return {
    version,
    format: Buffer.from(block.subarray(4, 20)),
    buffers,
    root,
    arrays,
    blobs,
    encode() {
      const head = Buffer.from(block.subarray(0, headerEnd));
      let out = buffers;
      let blobPart = block.subarray(blobsAt, blobsEnd);
      if (blobs.some((b, i) => !b.data.equals(originals[i]))) {
        if (version < 2) {
          out = [relaidInline(buffers[0], h.c1, h.c4, inline, originals, blobs.map((b) => b.data))];
          head.writeInt32LE(h.c1 + blobs.reduce((a, b, i) => a + b.data.length - originals[i].length, 0), h['@c1']);
          head.writeInt32LE(out[0].length, h['@unc']);
        } else {
          blobPart = rewriteBlobs(table!, blobs.map((b) => b.data));
          head.writeInt32LE(blobs.reduce((a, b) => a + b.data.length, 0), h['@blobs']);
        }
      }
      const packed = out.map((b) => (method === LZ4 ? lz4Literals(b) : b));
      if (method === LZ4) {
        if (version >= 5) {
          head.writeInt32LE(packed[0].length, h['@cmp1']);
          head.writeInt32LE(packed[1].length, h['@cmp2']);
          head.writeInt32LE(packed[0].length + packed[1].length, h['@cmp']);
        } else if (version > 1) {
          head.writeInt32LE(packed[0].length, h['@cmp']);
        }
      }
      return Buffer.concat([head, ...packed, blobPart, tail]);
    },
  };
}

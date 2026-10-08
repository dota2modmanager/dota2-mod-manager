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

/** Where one number lives: which decompressed buffer, and the byte offset in it. */
export interface Kv3Cell { buffer: 0 | 1; offset: number; width: 1 | 2 | 4 | 8; signed: boolean }

/** An array the walk found, with the member name it was under and a cell per element (null: no storage). */
export interface Kv3Array { key: string; path: string; cells: (Kv3Cell | null)[] }

/** A parsed block: its decompressed buffers, the arrays in it, and how to put it back together. */
export interface Kv3Block {
  version: number;
  buffers: Buffer[];
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
  const cell = (l: Lane, width: 1 | 2 | 4 | 8, signed: boolean): Kv3Cell => ({ buffer: l.buf, offset: take(l, width), width, signed });
  const readType = (): number => {
    let t = buf(types)[take(types, 1)];
    if (version >= 3) {
      if (t & 0x80) take(types, 1);
      if (t & 0x40) take(types, 1);
      t &= 0x3f;
    } else {
      if (t & 0x80) take(types, 1);
      t &= 0x7f;
    }
    return t;
  };
  const int4 = (l: Lane) => buf(l).readInt32LE(take(l, 4));
  const arrays: Kv3Array[] = [];

  // one value; returns a cell for numbers with storage, null for those without, undefined otherwise
  const value = (t: number, lanes: typeof main, key: string, path: string): Kv3Cell | null | undefined => {
    switch (t) {
      case 1: case 13: case 14: case 15: case 16: case 17: case 18: return null; // stored in the type alone
      case 2: take(lanes.l1, 1); return undefined;
      case 22: case 23: return cell(lanes.l1, 1, t === 22);
      case 20: case 21: return cell(lanes.l2, 2, t === 20);
      case 11: case 12: return cell(lanes.l4, 4, t === 11);
      case 19: take(lanes.l4, 4); return undefined; // float
      case 3: case 4: return cell(lanes.l8, 8, t === 3);
      case 5: take(lanes.l8, 8); return undefined; // double
      case 6: take(main.l4, 4); return undefined; // string id
      case 8: {
        const n = int4(main.l4);
        const cells: (Kv3Cell | null)[] = [];
        for (let k = 0; k < n; k++) { const c = value(readType(), main, key, `${path}[${k}]`); if (c !== undefined) cells.push(c); }
        if (cells.length === n) arrays.push({ key, path, cells });
        return undefined;
      }
      case 10: case 24: case 25: {
        const n = t === 10 ? int4(main.l4) : buf(main.l1)[take(main.l1, 1)];
        const sub = readType();
        const elementLanes = t === 25 ? aux : main;
        const cells: (Kv3Cell | null)[] = [];
        for (let k = 0; k < n; k++) { const c = value(sub, elementLanes, key, `${path}[${k}]`); if (c !== undefined) cells.push(c); }
        if (cells.length === n) arrays.push({ key, path, cells });
        return undefined;
      }
      case 9: {
        const n = objectLengths ? int4(objectLengths) : int4(main.l4);
        for (let k = 0; k < n; k++) {
          const ty = readType();
          const name = strings[int4(main.l4)] ?? '';
          value(ty, main, name, `${path}.${name}`);
        }
        return undefined;
      }
      default: throw new Error(`kv3: value type ${t} at ${path || 'the root'}`);
    }
  };
  value(readType(), main, '', '');
  for (const l of [main.l1, main.l2, main.l4, main.l8, types]) if (l.at !== l.end) throw new Error('kv3: the walk did not end where the data does');

  return {
    version,
    buffers,
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
  if (c.width === 1) return c.signed ? b.readInt8(c.offset) : b.readUInt8(c.offset);
  if (c.width === 2) return c.signed ? b.readInt16LE(c.offset) : b.readUInt16LE(c.offset);
  if (c.width === 4) return c.signed ? b.readInt32LE(c.offset) : b.readUInt32LE(c.offset);
  return Number(c.signed ? b.readBigInt64LE(c.offset) : b.readBigUInt64LE(c.offset));
}

/** Change a number where it lies. */
export function writeCell(kv: Kv3Block, c: Kv3Cell, v: number): void {
  const b = kv.buffers[c.buffer];
  if (c.width === 1) { if (c.signed) b.writeInt8(v, c.offset); else b.writeUInt8(v, c.offset); return; }
  if (c.width === 2) { if (c.signed) b.writeInt16LE(v, c.offset); else b.writeUInt16LE(v, c.offset); return; }
  if (c.width === 4) { if (c.signed) b.writeInt32LE(v, c.offset); else b.writeUInt32LE(v, c.offset); return; }
  if (c.signed) b.writeBigInt64LE(BigInt(v), c.offset); else b.writeBigUInt64LE(BigInt(v), c.offset);
}

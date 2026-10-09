/**
 * Binary blobs in a KV3 block (src/kv3.ts): where they lie, how they are read, and how they are
 * written back at a new length. Materials keep their expressions in them (src/material.ts).
 *
 * Before version 2 a blob is in the 1-byte lane, its length in the 4-byte lane. From version 2 the
 * buffer with the types goes on with every blob's length (int32), a trailer and the compressed size
 * of every LZ4 frame (uint16); the frames come after the buffers, chained so a later one can
 * reference an earlier blob, and a trailer closes them. The layout follows ValveResourceFormat's
 * BinaryKV3.cs (MIT).
 */
import { lz4DecodeInto, lz4Literals } from './lz4.ts';

const TRAILER = 0xffeedd00;
const align = (n: number, a: number) => (n + a - 1) & ~(a - 1);

/** Where a block from version 2 describes its blobs, in the buffer that holds its types. */
export interface BlobTable {
  buf: Buffer;
  lengthsAt: number;
  count: number;
  framesAt: number;
  frames: number;
  frameSize: number;
  lz4: boolean;
}

/**
 * The blob table after the types, or null when there are no blobs; either way the trailer that
 * follows the types (and the lengths) is checked.
 */
export function blobTable(buf: Buffer, typesEnd: number, count: number, lz4: boolean, frameSize: number): BlobTable | null {
  const trailerAt = typesEnd + count * 4;
  if (buf.readUInt32LE(trailerAt) !== TRAILER) throw new Error('kv3: no trailer after the types');
  if (!count) return null;
  const framesAt = trailerAt + 4;
  // the frame sizes run to the end of the buffer (version 4 writes 0 where version 5 gives their size)
  return { buf, lengthsAt: typesEnd, count, framesAt, frames: lz4 ? (buf.length - framesAt) / 2 : 0, frameSize: frameSize || 16384, lz4 };
}

/** Every blob's bytes, one after another, read from the block at `at`; and where they end. */
export function readBlobs(block: Buffer, at: number, t: BlobTable, total: number): { data: Buffer; end: number } {
  const lengths = Array.from({ length: t.count }, (_, k) => t.buf.readInt32LE(t.lengthsAt + k * 4));
  const data = Buffer.alloc(lengths.reduce((a, n) => a + n, 0));
  if (data.length !== total) throw new Error('kv3: the blob lengths do not add up');
  let p = at;
  if (!t.lz4) { block.copy(data, 0, p, p + data.length); p += data.length; }
  else {
    let f = 0;
    let o = 0;
    for (const n of lengths) {
      for (let left = n; left > 0; f++) {
        if (f >= t.frames) throw new Error('kv3: the blob frames ran out');
        const size = t.buf.readUInt16LE(t.framesAt + f * 2);
        const got = lz4DecodeInto(block.subarray(p, p + size), data, o, Math.min(t.frameSize, left));
        if (!got) throw new Error('kv3: an empty blob frame');
        p += size; o += got; left -= got;
      }
    }
    if (f !== t.frames) throw new Error('kv3: blob frames left over');
  }
  if (block.readUInt32LE(p) !== TRAILER) throw new Error('kv3: no trailer after the blobs');
  return { data, end: p + 4 };
}

/**
 * The blobs written as frames of literals, their lengths and frame sizes put in the table where
 * they were. The table keeps its length, so the buffer that holds it does too: a blob that would
 * take another number of frames is refused.
 * @returns the frames and the trailer, to go after the buffers
 */
export function rewriteBlobs(t: BlobTable, blobs: Buffer[]): Buffer {
  const chunks: Buffer[] = [];
  for (const b of blobs) for (let at = 0; at < b.length; at += t.frameSize) chunks.push(b.subarray(at, at + t.frameSize));
  if (t.lz4 && chunks.length !== t.frames) throw new Error('kv3: a new blob would take another number of frames');
  const packed = t.lz4 ? chunks.map(lz4Literals) : chunks;
  blobs.forEach((b, i) => t.buf.writeInt32LE(b.length, t.lengthsAt + i * 4));
  if (t.lz4) packed.forEach((c, i) => t.buf.writeUInt16LE(c.length, t.framesAt + i * 2));
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32LE(TRAILER);
  return Buffer.concat([...packed, trailer]);
}

/**
 * Before version 2: the first buffer laid out again with every blob's new bytes in the 1-byte lane
 * (`inline`: where each blob's bytes and its length were), the lanes after it realigned.
 */
export function relaidInline(old: Buffer, c1: number, c4: number, inline: { at: number; lengthAt: number }[], originals: Buffer[], blobs: Buffer[]): Buffer {
  const parts: Buffer[] = [];
  let from = 0;
  blobs.forEach((b, i) => {
    parts.push(old.subarray(from, inline[i].at), b);
    from = inline[i].at + originals[i].length;
  });
  parts.push(old.subarray(from, c1));
  const l1 = Buffer.concat(parts);
  const l4At = align(c1, 4);
  const l8At = align(l4At + c4 * 4, 8);
  const l4 = Buffer.from(old.subarray(l4At, l4At + c4 * 4));
  blobs.forEach((b, i) => l4.writeInt32LE(b.length, inline[i].lengthAt - l4At));
  const at4 = align(l1.length, 4);
  const at8 = align(at4 + l4.length, 8);
  return Buffer.concat([l1, Buffer.alloc(at4 - l1.length), l4, Buffer.alloc(at8 - at4 - l4.length), old.subarray(l8At)]);
}

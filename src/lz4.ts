/**
 * LZ4 block format: literals and back-references, the compression Valve's KV3 writer uses
 * (src/kv3.ts). Decoding is the whole format; encoding writes literals only, which any decoder
 * reads and which is all a rewritten block needs.
 */

/** One LZ4 block of exactly `size` bytes. */
export function lz4Decode(src: Buffer, size: number): Buffer {
  const out = Buffer.alloc(size);
  const n = lz4DecodeInto(src, out, 0, size);
  if (n !== size) throw new Error(`kv3: LZ4 gave ${n} bytes, expected ${size}`);
  return out;
}

/**
 * One LZ4 block decoded into `out` at `start`, at most `max` bytes. A reference may reach back past
 * `start` into what is already there: that is how the frames of a KV3 file's binary blobs are chained.
 * @returns how many bytes it gave
 */
export function lz4DecodeInto(src: Buffer, out: Buffer, start: number, max: number): number {
  let i = 0;
  let o = start;
  const end = start + max;
  const len = (n: number) => { let b; do { b = src[i++]; n += b; } while (b === 255); return n; };
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) lit = len(lit);
    if (o + lit > end) throw new Error('kv3: LZ4 ran past the output');
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
    if (o + match > end) throw new Error('kv3: LZ4 ran past the output');
    for (let from = o - back, k = 0; k < match; k++) out[o++] = out[from++];
  }
  return o - start;
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

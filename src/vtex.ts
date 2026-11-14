/* The picture inside a compiled Source 2 texture, when it is already a picture.
 *
 * Panorama's own images are authored as PNG and Valve compiles most of them with the format
 * left as PNG: the .vtex_c is a small resource header with the untouched PNG file appended
 * after it. Nothing has to be decoded, and the header says exactly where the picture starts -
 * its very first field is the size of the resource part.
 *
 * Measured over the installed game (2026-08-28): of 3000 item icons under
 * panorama/images/econ/items, 2877 are a ready-made PNG and 123 are block-compressed. So the
 * cosmetics picker can show almost every item straight from the game, offline and correct for
 * that build, with no 48 MB toolchain involved; the remainder still falls back to it.
 *
 * A block-compressed texture returns null here rather than a guess. Decoding BC formats is a
 * different job and the fallback already exists.
 */
import { encodePng } from './png-strip.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from('IEND', 'ascii');

/**
 * @param buf contents of a .vtex_c
 * @returns the PNG file it carries, or null when it carries pixels instead
 */
export function pngFromVtex(buf: unknown): Buffer | null {
  // fileSize is the first field of every Source 2 resource, and the picture is what follows
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  const headerBytes = buf.readUInt32LE(0);
  if (!headerBytes || headerBytes + PNG_SIGNATURE.length >= buf.length) return null;
  if (buf.compare(PNG_SIGNATURE, 0, PNG_SIGNATURE.length, headerBytes, headerBytes + PNG_SIGNATURE.length) !== 0) {
    return null;
  }
  const png = buf.subarray(headerBytes);
  // A tail that does not end on IEND is not a whole file, whatever its first bytes say.
  const end = png.lastIndexOf(IEND);
  if (end < 0 || end + 8 !== png.length) return null;
  return png;
}

/* The few panorama images that are not a PNG inside: the newest heroes' portraits among them
 * (Dawnbreaker, Marci, Muerta, Ringmaster and five more, measured on the game of 2026-11-14), each
 * a DXT5 texture of one mip with nothing packed around it, its colour stored as scaled YCoCg. Those two formats are small enough to
 * read here, so a portrait does not wait for the 48 MB toolchain. Anything else, more than one
 * mip, or a size that does not add up to the file (packed mips) still answers null. */
const DXT1 = 1, DXT5 = 2;

/** One 4x4 block's colour half (DXT1's whole block, DXT5's second 8 bytes) into `out` as RGBA. */
function colourBlock(b: Buffer, at: number, out: Uint8Array, alphaFromColour: boolean): void {
  const c0 = b.readUInt16LE(at), c1 = b.readUInt16LE(at + 2);
  const rgb = (c: number) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  const p0 = rgb(c0), p1 = rgb(c1);
  const four = !alphaFromColour || c0 > c1;
  const pal = [p0, p1,
    four ? p0.map((v, i) => (2 * v + p1[i]) / 3) : p0.map((v, i) => (v + p1[i]) / 2),
    four ? p0.map((v, i) => (v + 2 * p1[i]) / 3) : [0, 0, 0]];
  const bits = b.readUInt32LE(at + 4);
  for (let i = 0; i < 16; i++) {
    const k = (bits >>> (2 * i)) & 3;
    out[i * 4] = Math.round(pal[k][0]); out[i * 4 + 1] = Math.round(pal[k][1]); out[i * 4 + 2] = Math.round(pal[k][2]);
    out[i * 4 + 3] = alphaFromColour && !four && k === 3 ? 0 : 255;
  }
}

/** DXT5's alpha half (the block's first 8 bytes) over the alphas in `out`. */
function alphaBlock(b: Buffer, at: number, out: Uint8Array): void {
  const a0 = b[at], a1 = b[at + 1];
  const pal = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7);
  else { for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5); pal.push(0, 255); }
  // 48 bits of 3-bit indices, low first
  const lo = b.readUIntLE(at + 2, 3), hi = b.readUIntLE(at + 5, 3);
  for (let i = 0; i < 16; i++) out[i * 4 + 3] = Math.round(pal[i < 8 ? (lo >> (3 * i)) & 7 : (hi >> (3 * (i - 8))) & 7]);
}

/** A DXT1 or DXT5 texture of one mip, as RGBA; null for anything else. */
export function rgbaFromVtex(buf: unknown): { width: number; height: number; rgba: Buffer } | null {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  const header = buf.readUInt32LE(0);
  const blocksAt = 8 + buf.readUInt32LE(8), count = buf.readUInt32LE(12);
  let data = -1;
  for (let i = 0; i < count && blocksAt + i * 12 + 12 <= buf.length; i++) {
    const at = blocksAt + i * 12;
    if (buf.toString('latin1', at, at + 4) === 'DATA') data = at + 4 + buf.readUInt32LE(at + 4);
  }
  if (data < 0 || data + 28 > buf.length) return null;
  const width = buf.readUInt16LE(data + 20), height = buf.readUInt16LE(data + 22), depth = buf.readUInt16LE(data + 24);
  const format = buf[data + 26], mips = buf[data + 27];
  if ((format !== DXT1 && format !== DXT5) || mips !== 1 || depth > 1 || !width || !height) return null;
  const size = format === DXT1 ? 8 : 16;
  const across = Math.ceil(width / 4), down = Math.ceil(height / 4);
  if (header + across * down * size !== buf.length) return null;
  const rgba = Buffer.alloc(width * height * 4);
  const block = new Uint8Array(64);
  for (let by = 0; by < down; by++) {
    for (let bx = 0; bx < across; bx++) {
      const at = header + (by * across + bx) * size;
      colourBlock(buf, format === DXT1 ? at : at + 8, block, format === DXT1);
      if (format === DXT5) alphaBlock(buf, at, block);
      for (let y = 0; y < 4 && by * 4 + y < height; y++) {
        for (let x = 0; x < 4 && bx * 4 + x < width; x++) {
          const to = ((by * 4 + y) * width + bx * 4 + x) * 4;
          rgba.set(block.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4), to);
        }
      }
    }
  }
  // the compiler's "Image YCoCg Conversion" step: brightness in alpha, colour scaled into RGB
  if (buf.subarray(0, header).includes('YCoCg Conv', 0, 'latin1')) ycocg(rgba);
  return { width, height, rgba };
}

/** Scaled YCoCg (the colour in R and G, its scale in B, brightness in A) back into RGB, opaque. */
function ycocg(rgba: Buffer): void {
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let i = 0; i < rgba.length; i += 4) {
    const scale = (rgba[i + 2] >> 3) + 1;
    const co = (rgba[i] - 128) / scale, cg = (rgba[i + 1] - 128) / scale, y = rgba[i + 3];
    rgba[i] = clamp(y + co - cg); rgba[i + 1] = clamp(y + cg); rgba[i + 2] = clamp(y - co - cg); rgba[i + 3] = 255;
  }
}

/** The picture a .vtex_c carries: its PNG, or a one-mip DXT texture turned into one; null otherwise. */
export function pictureFromVtex(buf: unknown): Buffer | null {
  const png = pngFromVtex(buf);
  if (png) return png;
  const image = rgbaFromVtex(buf);
  return image && encodePng(image.width, image.height, image.rgba);
}

/* Pictures without Chromium, for the TypeScript host (host.ts) in place of Electron's nativeImage.
 * The main process asks it for little: a PNG read from a file or bytes, its pixels (BGRA, as
 * Electron hands them), a smaller copy, a PNG back. The codec is the one src/png-strip.ts already
 * has for the toolchain's output: 8-bit grey, grey+alpha, RGB, RGBA. */
import fs from 'node:fs';

import { decodePng, encodePng } from '../../src/png-strip.ts';

type Rgba = { width: number; height: number; rgba: Buffer };
/** Electron's leniency: a method this does not have answers nothing instead of throwing. */
type Lenient = <T extends object>(o: T) => T;

const swapRB = (px: Buffer): Buffer => {
  const out = Buffer.from(px);
  for (let i = 0; i + 3 < out.length; i += 4) { out[i] = px[i + 2]; out[i + 2] = px[i]; }
  return out;
};

/** A box filter down, the nearest pixel up: enough for thumbnails, which is what resize is for here. */
export function resized(img: Rgba, want: { width?: number; height?: number }): Rgba {
  const { width: w, height: h, rgba } = img;
  if (!w || !h) return img;
  const W = Math.max(1, Math.round(want.width ?? (want.height ? (w * want.height) / h : w)));
  const H = Math.max(1, Math.round(want.height ?? (want.width ? (h * want.width) / w : h)));
  if (W === w && H === h) return img;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * h) / H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * w) / W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / W));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const k = (yy * w + xx) * 4;
        r += rgba[k]; g += rgba[k + 1]; b += rgba[k + 2]; a += rgba[k + 3]; n++;
      }
      const o = (y * W + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: W, height: H, rgba: out };
}
const EMPTY: Rgba = { width: 0, height: 0, rgba: Buffer.alloc(0) };
const readPng = (buf: Buffer): Rgba | null => { try { return decodePng(buf); } catch { return null; } };

export function makeNativeImage(lenient: Lenient) {
  const imageOf = (img: Rgba | null): any => {
    const pic = img ?? EMPTY;
    let png: Buffer | null = null;
    const toPNG = () => (png ??= pic.width ? encodePng(pic.width, pic.height, pic.rgba) : Buffer.alloc(0));
    return lenient({
      isEmpty: () => pic.width === 0,
      getSize: () => ({ width: pic.width, height: pic.height }),
      toPNG,
      toDataURL: () => `data:image/png;base64,${toPNG().toString('base64')}`,
      toBitmap: () => swapRB(pic.rgba),
      getBitmap: () => swapRB(pic.rgba),
      resize: (opts: { width?: number; height?: number } = {}) => imageOf(resized(pic, opts)),
    });
  };
  return lenient({
    createFromBuffer: (buf: Buffer) => imageOf(readPng(Buffer.from(buf ?? []))),
    createFromPath: (file: string) => { try { return imageOf(readPng(fs.readFileSync(file))); } catch { return imageOf(null); } },
    createFromBitmap: (px: Buffer, size: { width: number; height: number }) =>
      imageOf(size?.width && size?.height ? { width: size.width, height: size.height, rgba: swapRB(Buffer.from(px)) } : null),
    createFromDataURL: (url: string) => imageOf(readPng(Buffer.from(String(url).split(',')[1] ?? '', 'base64'))),
    createEmpty: () => imageOf(null),
  });
}

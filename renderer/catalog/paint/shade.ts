/* A picture in the colour its layer is getting, so the colour is seen before the pak is built.
 *
 * Drawn by the rule the build itself uses on an icon (src/recolor.ts shade, src/recolor-layers.ts
 * shadePixels): a grey pixel stays, every other takes the chosen hue, its saturation and brightness
 * scaled by the colour's. What the window shows is then what the game will. */
import { useEffect, useState } from 'react';
import { fromHex, hsv, rgbOf, type Rgb } from '../arcana/tint.ts';

const done = new Map<string, string>();

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('picture'));
    img.src = src;
  });
}

/** One pixel as the build moves it: null where it stays. */
export function shadePixel(from: Rgb, target: Rgb): Rgb | null {
  const [, s, v] = hsv(from);
  if (s < 0.1) return null;
  const [th, ts, tv] = hsv(target);
  return rgbOf(th, Math.min(1, s * ts), Math.min(1, v * tv));
}

/** The picture at `src` in `rgb`, as a data URL. */
export async function shaded(src: string, rgb: Rgb): Promise<string> {
  const key = `${rgb.join(',')}|${src.length}|${src.slice(-48)}`;
  const known = done.get(key);
  if (known) return known;
  const img = await load(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const to = shadePixel([d[i], d[i + 1], d[i + 2]], rgb);
    if (to) [d[i], d[i + 1], d[i + 2]] = to;
  }
  ctx.putImageData(pixels, 0, 0);
  const url = canvas.toDataURL('image/png');
  done.set(key, url);
  return url;
}

/** The picture in `hex`, or as it is when `hex` is null; the plain one until the shaded one is ready. */
export function useShaded(src: string | null, hex: string | null): string | null {
  const [url, setUrl] = useState(src);
  useEffect(() => {
    const rgb = hex ? fromHex(hex) : null;
    if (!src || !rgb) { setUrl(src); return; }
    let live = true;
    shaded(src, rgb).then((u) => { if (live) setUrl(u); }, () => { if (live) setUrl(src); });
    return () => { live = false; };
  }, [src, hex]);
  return url;
}

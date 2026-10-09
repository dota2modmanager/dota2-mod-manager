/* The arcana's picture in the colour being chosen, so the colour is seen before the game is started.
 *
 * What the gem lights in the picture is its glow: the pixels both bright and much redder than they
 * are anything else. Those take the chosen hue, their saturation and brightness scaled by the
 * chosen colour's, the way written colours move in the mod (src/recolor.ts, shade); the dark armour
 * and the green of the wings stay where they are. Scaling channel by channel, as the game does to
 * the gem itself, turned the dark red of the armour blue: its blue channel was multiplied by 5.5. */
import { useEffect, useState } from 'react';

export type Rgb = [number, number, number];

/** The colour of the gem the arcana comes with, Reflection's Shade (src/recolor.ts). */
export const GEM: Rgb = [255, 60, 40];

const done = new Map<string, string>();

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('picture'));
    img.src = src;
  });
}

/** The picture at `src` as the game would show it in `rgb`, as a data URL. */
export async function tinted(src: string, rgb: Rgb): Promise<string> {
  if (rgb.every((n, c) => n === GEM[c])) return src;
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
  const [th, ts, tv] = hsv(rgb);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const red = Math.min(1, Math.max(0, ((r - Math.max(d[i + 1], d[i + 2])) / Math.max(1, r)) * 1.6));
    const lit = red * Math.min(1, Math.max(0, (r - 60) / 90));
    if (!lit) continue;
    const [, s, v] = hsv([r, d[i + 1], d[i + 2]]);
    const next = rgbOf(th, Math.min(1, s * ts), Math.min(1, v * tv));
    for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] + (next[c] - d[i + c]) * lit);
  }
  ctx.putImageData(pixels, 0, 0);
  const url = canvas.toDataURL('image/png');
  done.set(key, url);
  return url;
}

function hsv([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b) / 255;
  const d = max - Math.min(r, g, b) / 255;
  let h = 0;
  if (d) {
    if (max === r / 255) h = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max];
}

function rgbOf(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((n) => Math.round((n + m) * 255)) as Rgb;
}

/** The picture in a colour, the plain one until the tinted one is ready. */
export function useTinted(src: string | null, rgb: Rgb): string | null {
  const [url, setUrl] = useState(src);
  const key = rgb.join(',');
  useEffect(() => {
    if (!src) { setUrl(null); return; }
    let live = true;
    tinted(src, rgb).then((u) => { if (live) setUrl(u); }, () => { if (live) setUrl(src); });
    return () => { live = false; };
    // rgb is read through its key: a new array of the same colour is the same picture
  }, [src, key]);
  return url;
}

let picture: Promise<string | null> | null = null;

/** The arcana's own picture out of the game, asked for once (src/arcana-service.ts). */
export function useArcanaPicture(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    picture ??= window.api.arcana.state().then((s) => (s.error ? null : s.picture), () => null);
    picture.then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, []);
  return url;
}

export const toHex = (c: Rgb) => `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;

export function fromHex(text: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb : null;
}

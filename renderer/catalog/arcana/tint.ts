/* An arcana's picture in the colour being chosen, so the colour is seen before the game is started.
 *
 * What the gem lights in the picture is its glow. On Terrorblade's: the pixels both bright and much
 * redder than they are anything else. On Techies' cart, whose gem is gold: the bright, saturated
 * pixels of the gem's own hue, the orange of the pigs' armour left out. Those take the chosen hue,
 * their saturation and brightness scaled by the chosen colour's, the way written colours move in
 * the mod (src/recolor.ts, shade); the dark armour and the green of the wings stay where they are.
 * Scaling channel by channel, as the game does to the gem itself, turned the dark red of the
 * armour blue: its blue channel was multiplied by 5.5. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { cosmeticIcon, cosmeticIconKnown, loadCosmeticIcons, subscribeIcon } from '../../ui/cosmetic-icons.ts';

export type Rgb = [number, number, number];

/** The colour of the gem Terrorblade's arcana comes with, Reflection's Shade (src/recolor.ts). */
export const GEM: Rgb = [255, 60, 40];

/** Each arcana's own gem (src/recolor.ts RECOLOR_SETS), the colour its picture is drawn in. */
export const GEMS: Record<string, Rgb> = {
  'terrorblade-arcana': GEM, 'techies-arcana': [255, 175, 0],
  // the immortals have no gem: the commonest colour of their effects stands in for one
  'terrorblade-span': [64, 192, 255], 'terrorblade-scythes': [160, 224, 255], 'razor-crest': [192, 192, 255],
};

/** The gem an arcana comes with, Terrorblade's for one this window does not know. */
export const gemOf = (set: string | null | undefined): Rgb => (set && GEMS[set]) || GEM;

const done = new Map<string, string>();

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('picture'));
    img.src = src;
  });
}

/** The picture at `src`, whose gem is `gem`, as the game would show it in `rgb`, as a data URL. */
export async function tinted(src: string, rgb: Rgb, gem: Rgb = GEM): Promise<string> {
  if (rgb.every((n, c) => n === gem[c])) return src;
  const key = `${rgb.join(',')}|${gem.join(',')}|${src.length}|${src.slice(-48)}`;
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
  const lights = gem.every((n, c) => n === GEM[c]) ? redGlow : hueGlow(hsv(gem)[0]);
  for (let i = 0; i < d.length; i += 4) {
    const lit = lights(d[i], d[i + 1], d[i + 2]);
    if (!lit) continue;
    const [, s, v] = hsv([d[i], d[i + 1], d[i + 2]]);
    const next = rgbOf(th, Math.min(1, s * ts), Math.min(1, v * tv));
    for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] + (next[c] - d[i + c]) * lit);
  }
  ctx.putImageData(pixels, 0, 0);
  const url = canvas.toDataURL('image/png');
  done.set(key, url);
  tintedFrom.set(url, src);
  return url;
}

/** How much Reflection's Shade lights a pixel: bright, and much redder than anything else. */
function redGlow(r: number, g: number, b: number): number {
  const red = Math.min(1, Math.max(0, ((r - Math.max(g, b)) / Math.max(1, r)) * 1.6));
  return red * Math.min(1, Math.max(0, (r - 60) / 90));
}

/** How much a gem of hue `gh` lights a pixel: its hue within 18 degrees of the gem's, bright and saturated. */
const hueGlow = (gh: number) => (r: number, g: number, b: number): number => {
  const [h, s, v] = hsv([r, g, b]);
  const off = Math.min(Math.abs(h - gh), 360 - Math.abs(h - gh));
  const near = Math.max(0, 1 - off / 18);
  return near * Math.min(1, Math.max(0, (s - 0.45) / 0.3)) * Math.min(1, Math.max(0, (v - 0.55) / 0.3));
};

export function hsv([r, g, b]: Rgb): [number, number, number] {
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

export function rgbOf(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((n) => Math.round((n + m) * 255)) as Rgb;
}

/** The picture in a colour, the plain one until the tinted one is ready. */
export function useTinted(src: string | null, rgb: Rgb, gem: Rgb = GEM): string | null {
  const [url, setUrl] = useState(src);
  const key = `${rgb.join(',')}|${gem.join(',')}`;
  useEffect(() => {
    if (!src) { setUrl(null); return; }
    let live = true;
    tinted(src, rgb, gem).then((u) => { if (live) setUrl(u); }, () => { if (live) setUrl(src); });
    return () => { live = false; };
    // the colours are read through their key: a new array of the same colour is the same picture
  }, [src, key]);
  return url;
}

/** What the picture of an arcana is drawn from: the game's own, or the item's name to fetch it by. */
export interface ArcanaPicture { picture: string | null; name: string }

let asked: Promise<Map<string, ArcanaPicture>> | null = null;

/**
 * An arcana's own picture out of the game (src/arcana-service.ts), asked for once unless `known`
 * already has it. Techies' is block-compressed, which the main process does not decode on its own:
 * that one comes through the item pictures' loader by the item's name, from the toolchain or the wiki.
 */
export function useArcanaPicture(set: string, known?: ArcanaPicture | null): string | null {
  const [got, setGot] = useState<ArcanaPicture | null>(known ?? null);
  useEffect(() => {
    if (known) { setGot(known); return; }
    let live = true;
    asked ??= window.api.arcana.state().then(
      (s) => new Map((s.error ? [] : s.arcanas).map((a) => [a.set, { picture: a.picture, name: a.name }])),
      () => new Map(),
    );
    asked.then((m) => { if (live) setGot(m.get(set) ?? null); });
    return () => { live = false; };
  }, [set, known?.picture, known?.name]);
  const name = got && !got.picture ? got.name : '';
  const icon = useSyncExternalStore((fn) => subscribeIcon(name, fn), () => (name ? cosmeticIcon(name) : null));
  useEffect(() => { if (name && !cosmeticIconKnown(name)) void loadCosmeticIcons([name], () => {}); }, [name]);
  return useTrimmed(got?.picture ?? icon ?? null);
}

const trims = new Map<string, Promise<string>>();
/** Pictures that stand on nothing (a set's art, Techies'): drawn whole, without the faded edge a square icon gets. */
const cutOut = new Set<string>();
/** Whether a picture this file handed out stands on nothing; a tinted copy of it counts too. */
export const isCutOut = (src: string | null): boolean => !!src && (cutOut.has(src) || [...cutOut].some((c) => tintedFrom.get(src) === c));
const tintedFrom = new Map<string, string>();

/**
 * The picture cut to what is drawn on it. A set's art stands on nothing, with empty room round the
 * figure (Techies' cart filled the lower right of a tall frame), so the window showed it off centre
 * and small; a square icon has no empty edge and comes back as it was.
 */
function trim(src: string): Promise<string> {
  let p = trims.get(src);
  if (p) return p;
  p = load(src).then((img) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return src;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] < 16) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) return src;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d')?.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    const url = out.toDataURL('image/png');
    cutOut.add(url);
    return url;
  }, () => src);
  trims.set(src, p);
  return p;
}

/** A picture cut to its figure, once the cut is made (null until then). */
export function useTrimmed(src: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) { setUrl(null); return; }
    let live = true;
    trim(src).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [src]);
  return url;
}

export const toHex = (c: Rgb) => `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;

export function fromHex(text: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb : null;
}

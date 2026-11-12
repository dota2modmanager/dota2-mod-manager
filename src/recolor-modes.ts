/* How a picture takes its layer's colour in the hero's recolour (issue #422): the window offers a
 * mode beside the colour, and the build, the window's pictures (renderer/catalog/paint/shade.ts)
 * and the 3D preview's shader (vendor/dota-loadout/src/material.js, studioPaint) all move a pixel
 * by the same rule, so what the 3D hero shows is what the game will.
 *
 *   tint   greys stay; the rest take the hue, their saturation and brightness scaled by the colour's
 *          (the rule particles follow too, src/recolor.ts shade)
 *   keep   greys stay; the rest take the hue alone, so every shade and highlight of the item stays
 *   full   every pixel takes the hue and the colour's saturation: the item painted over, greys too
 *   rgb    greys stay; the hue runs once round the wheel across the texture, from the colour's own
 *
 * A layer's colour travels as '#rrggbb' or '#rrggbb:mode'; the plain form is tint, which is how
 * every record made before the modes reads. */

export type Rgb = [number, number, number];
/** How a picture takes its layer's colour; the comment at the top of this file says what each does. */
export type PaintMode = 'tint' | 'keep' | 'full' | 'rgb';
/** The modes in the order the window offers them. */
export const PAINT_MODES: readonly PaintMode[] = ['tint', 'keep', 'full', 'rgb'];

const PAINT = /^(#[0-9a-f]{6})(?::(tint|keep|full|rgb))?$/i;

/** A layer's colour and mode out of '#rrggbb[:mode]'; null for anything else. */
export function parsePaint(value: unknown): { hex: string; mode: PaintMode } | null {
  const m = typeof value === 'string' ? PAINT.exec(value) : null;
  return m ? { hex: m[1].toLowerCase(), mode: (m[2]?.toLowerCase() as PaintMode) || 'tint' } : null;
}

/** '#rrggbb' for tint, '#rrggbb:mode' for the rest. */
export const paintValue = (hex: string, mode: PaintMode = 'tint'): string => (mode === 'tint' ? hex.toLowerCase() : `${hex.toLowerCase()}:${mode}`);

/** '#rrggbb' as its three channels. */
export const rgbOfHex = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

/** h in [0, 1), s and v in [0, 1]. */
export function hsv([r, g, b]: Rgb): Rgb {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), d = max - Math.min(R, G, B);
  let h = 0;
  if (d) h = max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, max ? d / max : 0, max];
}

/** A colour out of `hsv`'s h, s and v, back to 0-255 channels. */
export function fromHsv([h, s, v]: Rgb): Rgb {
  const k = (n: number) => (n + h * 6) % 6;
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255)) as Rgb;
}

/**
 * One pixel in the colour, by the mode; null where it stays as it is.
 * @param target the colour as HSV (`hsv`), worked out once for the whole picture
 * @param u,v    where the pixel is on the texture, 0 to 1: the rainbow runs along them
 */
export function paintPixel(from: Rgb, target: Rgb, mode: PaintMode, u = 0, v = 0): Rgb | null {
  const [, s, val] = hsv(from);
  const [th, ts, tv] = target;
  if (mode === 'full') return fromHsv([th, ts, Math.min(1, val * tv)]);
  if (s < 0.1) return null;
  if (mode === 'keep') return fromHsv([th, s, val]);
  if (mode === 'rgb') return fromHsv([(th + (u % 1 + v % 1) * 0.5) % 1, Math.max(s, 0.6), Math.min(1, val * Math.max(tv, 0.5) * 1.2)]);
  return fromHsv([th, Math.min(1, s * ts), Math.min(1, val * tv)]);
}

/**
 * A bitmap moved to the colour in place, four bytes a pixel; `bgra` says red and blue are swapped,
 * as Electron's bitmaps have them on Windows. Answers how many pixels changed.
 */
export function paintPixels(pixels: Buffer | Uint8ClampedArray, width: number, color: Rgb, mode: PaintMode, { bgra = false }: { bgra?: boolean } = {}): number {
  const [r, b] = bgra ? [2, 0] : [0, 2];
  const target = hsv(color);
  const height = Math.max(1, Math.floor(pixels.length / 4 / Math.max(1, width)));
  let changed = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const at = i / 4;
    const to = paintPixel([pixels[i + r], pixels[i + 1], pixels[i + b]], target, mode, ((at % width) + 0.5) / width, (Math.floor(at / width) + 0.5) / height);
    if (!to || (to[0] === pixels[i + r] && to[1] === pixels[i + 1] && to[2] === pixels[i + b])) continue;
    pixels[i + r] = to[0];
    pixels[i + 1] = to[1];
    pixels[i + b] = to[2];
    changed++;
  }
  return changed;
}

/* The ways a picture takes its layer's colour, as the window offers them. The rule is the build's
 * (src/recolor-modes.ts), and the 3D preview's shader draws it the same way
 * (vendor/dota-loadout/src/material.js, studioPaint): what the window shows is what the game will.
 *
 * A layer's colour goes to the main process as '#rrggbb' (tint) or '#rrggbb:mode'. */
import type { Rgb } from '../arcana/tint.ts';

export type PaintMode = 'tint' | 'keep' | 'full' | 'rgb';
export const PAINT_MODES: readonly PaintMode[] = ['tint', 'keep', 'full', 'rgb'];

/** The shader's number for a mode: 0 is off. */
export const modeNumber = (mode: PaintMode): number => PAINT_MODES.indexOf(mode) + 1;

/** A stored colour split into its colour and mode; a plain or unknown one is tint. */
export function splitPaint(value: string): { hex: string; mode: PaintMode } {
  const [hex, mode] = value.split(':');
  return { hex: hex.toLowerCase(), mode: PAINT_MODES.includes(mode as PaintMode) ? mode as PaintMode : 'tint' };
}

export const paintValue = (hex: string, mode: PaintMode): string => (mode === 'tint' ? hex.toLowerCase() : `${hex.toLowerCase()}:${mode}`);

/** h in [0, 1), s and v in [0, 1]. */
export function hsv01([r, g, b]: Rgb): Rgb {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), d = max - Math.min(R, G, B);
  let h = 0;
  if (d) h = max === R ? ((G - B) / d + 6) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, max ? d / max : 0, max];
}

function rgb01([h, s, v]: Rgb): Rgb {
  const k = (n: number) => (n + h * 6) % 6;
  const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255)) as Rgb;
}

/** One pixel in the colour (as `hsv01`), by the mode; null where it stays. u, v: where it is on the picture. */
export function paintPixel(from: Rgb, target: Rgb, mode: PaintMode, u = 0, v = 0): Rgb | null {
  const [, s, val] = hsv01(from);
  const [th, ts, tv] = target;
  if (mode === 'full') return rgb01([th, ts, Math.min(1, val * tv)]);
  if (s < 0.1) return null;
  if (mode === 'keep') return rgb01([th, s, val]);
  if (mode === 'rgb') return rgb01([(th + (u % 1 + v % 1) * 0.5) % 1, Math.max(s, 0.6), Math.min(1, val * Math.max(tv, 0.5) * 1.2)]);
  return rgb01([th, Math.min(1, s * ts), Math.min(1, val * tv)]);
}

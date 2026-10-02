/* The tempo and the spacing every animation Motion plays with, read from tokens.css rather than
 * written here, so the stylesheet stays the one place they are set - and the system's reduced-motion
 * setting, which flattens every duration there to 1ms, reaches these too. */

import { tokenMs } from '../core/css-time.ts';

const css = (): CSSStyleDeclaration => getComputedStyle(document.documentElement);

/** A duration token, in the seconds Motion takes (the build writes 300ms as .3s: core/css-time.ts). */
export const dur = (token: string): number => tokenMs(token) / 1000;

/** An easing token, as the four numbers of its cubic-bezier. */
export function ease(token: string): [number, number, number, number] {
  const m = css().getPropertyValue(token).match(/cubic-bezier\(([^)]+)\)/);
  const n = m ? m[1].split(',').map(Number) : [];
  return n.length === 4 && n.every(Number.isFinite) ? [n[0], n[1], n[2], n[3]] : [0.2, 0, 0, 1];
}

/** Whether the system asked for less motion. */
export const stillness = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A length token on :root, in pixels. */
export const px = (token: string): number => parseFloat(css().getPropertyValue(token)) || 0;

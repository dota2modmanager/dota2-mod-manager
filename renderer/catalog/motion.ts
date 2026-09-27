/* The tempo of every animation Motion plays, read from tokens.css rather than written here, so the
 * stylesheet stays the one place it is set - and the system's reduced-motion setting, which
 * flattens every duration there to 1ms, reaches these too. */

const css = (): CSSStyleDeclaration => getComputedStyle(document.documentElement);

/** A duration token, in the seconds Motion takes. */
export function dur(token: string): number {
  return (parseFloat(css().getPropertyValue(token)) || 0) / 1000;
}

/** An easing token, as the four numbers of its cubic-bezier. */
export function ease(token: string): [number, number, number, number] {
  const m = css().getPropertyValue(token).match(/cubic-bezier\(([^)]+)\)/);
  const n = m ? m[1].split(',').map(Number) : [];
  return n.length === 4 && n.every(Number.isFinite) ? [n[0], n[1], n[2], n[3]] : [0.2, 0, 0, 1];
}

/** Whether the system asked for less motion. */
export const stillness = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

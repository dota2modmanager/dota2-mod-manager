/**
 * Whether the hunt (components/Hunt.astro) can start for this visitor, in one place.
 *
 * The riddles (scripts/hunt-notes.ts) invite a hunt, so they are only worth showing where the hunt
 * would place its heroes. The two used to decide that each on their own, and they drifted: a
 * window too narrow for the margins got the riddles and no heroes (#386). Both ask here now.
 */

/** The page's column, and the room a hero needs beside it. */
const COLUMN = 1200;
const GUTTER = 70;

/** A fine pointer to light the margins with, and motion allowed: the hunt is for those only. */
export function huntAllowed(): boolean {
  return matchMedia('(hover: hover) and (pointer: fine)').matches
    && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The margin beside the column. clientWidth rather than innerWidth: the scrollbar is no margin. */
export function huntGutter(vw = document.documentElement.clientWidth): number {
  return Math.max(0, (vw - Math.min(COLUMN, vw)) / 2);
}

/** Room beside the column for a hero: no hunt on a narrow window. */
export const huntFits = (vw?: number) => huntGutter(vw) >= GUTTER;

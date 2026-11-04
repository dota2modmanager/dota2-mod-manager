/* When a wheel tick should have moved a pane and did not (ui/scroll-watch.ts, issue #330). Apart
 * from the watch so a test can ask it without a window. */

/** One tick as the watch saw it: where the pane was before and after, and how far it can go. */
export interface Tick { dy: number; before: number; after: number; max: number }

/** The tick had room in the way it was turned, and the pane stayed where it was. */
export const stuck = ({ dy, before, after, max }: Tick): boolean =>
  Math.abs(after - before) < 1 && ((dy > 0 && before < max - 1) || (dy < 0 && before > 1));

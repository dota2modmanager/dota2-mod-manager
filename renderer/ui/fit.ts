/* The window's own share of the scale. The layout is drawn for a 1440x900 window (src/main-window.ts
 * sizes the first window that way); a maximized one used to show the same layout in its corner
 * with the rest of the screen empty. Now a bigger window adds a little: a third of how much bigger
 * it is, so full HD maximized reads 10% larger, not the 30% that made it look blown up.
 *
 * It depends on the window alone, never on the scale in Settings, and multiplies it: the user's
 * number keeps its meaning, so 95% is always smaller than 100%. (A version that let the chosen
 * scale count toward the room made 95% come out larger.) The height holds it back only for a
 * window much shorter than it is wide: the pages scroll, so a little less height is fine. */
const DESIGNED = { width: 1440, height: 900 };
/** how much of the window's extra size the interface takes up */
const SHARE = 1 / 3;
const FIT_MAX = 1.3;
/** how much shorter than designed a window may be, for its width, before the height decides */
const HEIGHT_SLACK = 0.85;

/** How much the window's size adds to the chosen scale (1 for a window of the designed size or smaller). */
export function fitFor(width: number, height: number): number {
  const room = Math.min(width / DESIGNED.width, height / (DESIGNED.height * HEIGHT_SLACK));
  const grow = 1 + Math.max(0, room - 1) * SHARE;
  // in steps of 5%, so dragging the window's edge does not reflow at every pixel
  return Math.min(FIT_MAX, Math.floor(grow * 20 + 1e-9) / 20);
}

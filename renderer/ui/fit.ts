/* The window's own share of the scale. The layout is drawn for a 1440x900 window at the chosen
 * scale (src/main-window.ts sizes the first window that way); a window bigger than that, a
 * maximized one above all, used to show the same layout in its corner with the rest of the screen
 * empty. Now everything grows with the window's width, the way the game's own interface grows
 * with the screen. The height holds it back only for a window much shorter than it is wide (the
 * pages scroll, so a little less height than designed is fine; a strip is not). The scale in
 * Settings stays the user's number; this rides on top of it and never shrinks below it. */
const DESIGNED = { width: 1440, height: 900 };
const FIT_MAX = 1.5;
/** how much shorter than designed a window may be, for its width, before the height decides */
const HEIGHT_SLACK = 0.85;

/** How much the window's size adds to the chosen scale (1 for a window of the designed size or smaller). */
export function fitFor(width: number, height: number, scale: number): number {
  const room = Math.min(width / (DESIGNED.width * scale), height / (DESIGNED.height * HEIGHT_SLACK * scale));
  // in steps of 5%, so dragging the window's edge does not reflow every pixel
  return Math.min(FIT_MAX, Math.max(1, Math.floor(room * 20) / 20));
}

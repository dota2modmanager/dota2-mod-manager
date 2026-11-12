/* Where in a frame an effect drew: the part of an effect's picture that needs no WebGL to check. */

/** A channel above this counts as drawn: the frame is on black, and glow fades into it. */
const DRAWN = 40;
/** Fewer drawn pixels than this is a dark picture the glyph says more than: a few effects take all their colour from the courier that wears them. */
const TOO_FEW = 12;

/**
 * The box around what a frame drew, widened to the picture's shape with a margin, or null for a
 * dark frame. Alpha plays no part: an additive particle writes colour and hardly any alpha, and
 * counting alpha called most of the game's effects dark.
 */
export function drawnBox(px: Uint8ClampedArray, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  let left = width, right = -1, top = height, bottom = -1, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.max(px[i], px[i + 1], px[i + 2]) <= DRAWN) continue;
      count++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (count < TOO_FEW) return null;
  const shape = width / height;
  const h = Math.min(height, Math.max((bottom - top + 1) * 1.3, (right - left + 1) * 1.3 / shape, height / 4));
  const w = h * shape;
  const clamp = (at: number, size: number, whole: number) => Math.max(0, Math.min(at, whole - size));
  return { x: clamp((left + right + 1 - w) / 2, w, width), y: clamp((top + bottom + 1 - h) / 2, h, height), w, h };
}

/* A duration token from tokens.css, in milliseconds.
 *
 * The stylesheet writes 200ms, and the build that minifies it writes .2s: both are the same time,
 * and code reading one as the other gets a thousand times too short. That is how the mod window
 * came to close in a fifth of a millisecond once Vite built the page. */

/** "200ms", ".2s", "1ms" -> milliseconds; anything else -> 0. */
export function parseCssTime(value) {
  const v = String(value || '').trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  if (/ms$/i.test(v)) return n;
  if (/s$/i.test(v)) return n * 1000;
  return n;
}

/** The token's value on the document, in milliseconds. */
export function tokenMs(name) {
  return parseCssTime(getComputedStyle(document.documentElement).getPropertyValue(name));
}

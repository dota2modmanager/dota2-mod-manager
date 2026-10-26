/* The jack-o'-lantern, drawn once for everything that shows one: the pumpkin in the title bar and
 * its window (ui/pumpkin.ts, coloured and lit by styles/pumpkin.css), and the mascot of the two
 * themes the pumpkin opens (ui/theme.ts), where it is an <img> and so carries its own colours.
 */

const STEM = 'M30 14c0-5 2-9 7-11l2 3c-3 2-4 4-4 8z';
const BODY = 'M32 15c-6-4-17-3-23 4C2 27 2 43 9 51c6 7 16 9 23 6 7 3 17 1 23-6 7-8 7-24 0-32-6-7-17-8-23-4z';
const RIB = 'M32 15c-5 6-6 34 0 42M32 15c5 6 6 34 0 42M19 17c-7 9-7 29 2 38M45 17c7 9 7 29-2 38';
const FACE = ['M16 31l7-7 6 8z', 'M48 31l-7-7-6 8z', 'M14 39c5 7 12 10 18 10s13-3 18-10l-5 2-3-4-4 5-6-4-6 4-4-5-3 4z'];
const DRIP = ['M20 46q1 6 0 9q-2 2-2-1q0-4 2-8z', 'M41 47q1 4 0 7q-2 1-2-1q0-3 2-6z'];

/** For the title bar and the window: classes only, styles/pumpkin.css colours it. */
export const PUMPKIN_SVG = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <path class="pk-stem" d="${STEM}"/>
  <path class="pk-body" d="${BODY}"/>
  <path class="pk-rib" d="${RIB}"/>
  <g class="pk-face">${FACE.map((d) => `<path d="${d}"/>`).join('')}</g>
  <g class="pk-drip">${DRIP.map((d) => `<path d="${d}"/>`).join('')}</g>
</svg>`;

/**
 * The mascot of the ninth theme (`bloody` false: an orange lantern) and of the tenth (`bloody`:
 * a dark red one bleeding from its grin), as a data: address for the mascot's <img>.
 */
export function pumpkinMascot(bloody: boolean): string {
  const body = bloody ? '#7a0a12' : '#ff8a2b';
  const rib = bloody ? '#4a0309' : '#c9621a';
  const light = bloody ? '#ff3b3b' : '#ffd36e';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<path d="${STEM}" fill="${bloody ? '#2b3a1c' : '#6b8f3e'}"/>`
    + `<path d="${BODY}" fill="${body}"/>`
    + `<path d="${RIB}" fill="none" stroke="${rib}" stroke-width="1.6"/>`
    + FACE.map((d) => `<path d="${d}" fill="${light}"/>`).join('')
    + (bloody ? DRIP.map((d) => `<path d="${d}" fill="#c4111f"/>`).join('') : '')
    + '</svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

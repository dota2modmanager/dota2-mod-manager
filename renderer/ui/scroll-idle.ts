/* When the page has stopped scrolling, for work that would stall a frame.
 *
 * Showing a 3D hero for the first time costs one frame of 150-700 ms (shaders and textures going
 * to the GPU, catalog/preview3d), and a list scrolled beside it stops dead for that frame: it
 * read as scrolling being jerky. Such work waits here for a pause in the wheel instead, so the
 * cost lands on a frame nobody is watching move. Not forever: someone who keeps scrolling gets
 * it after `most` all the same. */

let last = 0;

/* While the page moves, what is under the pointer is not asked about. Cards slide under a still
 * pointer as the list scrolls, and each one it crossed was hit-tested, put on hover (lifted,
 * scaled, its shadow grown) and painted again, then let go a frame later: on a machine drawing
 * without a GPU that was most of a scroll's time. The class goes on with the first tick and off
 * once the wheel has been quiet a moment; the browser looks under the pointer again then. */
const CALM_MS = 140;
let calm: ReturnType<typeof setTimeout> | null = null;
const root = document.documentElement;
function moving(): void {
  if (!calm) root.classList.add('is-scrolling');
  else clearTimeout(calm);
  calm = setTimeout(() => { calm = null; root.classList.remove('is-scrolling'); }, CALM_MS);
}

const mark = (e: Event): void => {
  last = performance.now();
  // only the page's own list: a scroll inside a window or a menu keeps its pointer
  if (e.type !== 'touchmove' && (e.target === mainPane() || (e.type === 'wheel' && mainPane()?.contains(e.target as Node)))) moving();
};
let main: HTMLElement | null = null;
const mainPane = (): HTMLElement | null => (main ||= document.getElementById('main'));
for (const type of ['wheel', 'scroll', 'touchmove'] as const) {
  document.addEventListener(type, mark, { capture: true, passive: true });
}

/** Whether something scrolled within the last `quiet` ms. */
export const scrolling = (quiet = 200): boolean => performance.now() - last < quiet;

/** Resolves once nothing has scrolled for `quiet` ms, or after `most` ms whatever happens. */
export function scrollIdle(quiet = 200, most = 10_000): Promise<void> {
  const until = performance.now() + most;
  return new Promise((done) => {
    const check = (): void => {
      if (!scrolling(quiet) || performance.now() >= until) done();
      else setTimeout(check, Math.max(16, quiet - (performance.now() - last)));
    };
    check();
  });
}

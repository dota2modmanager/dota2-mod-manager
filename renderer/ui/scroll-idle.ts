/* When the page has stopped scrolling, for work that would stall a frame.
 *
 * Showing a 3D hero for the first time costs one frame of 150-700 ms (shaders and textures going
 * to the GPU, catalog/preview3d), and a list scrolled beside it stops dead for that frame: it
 * read as scrolling being jerky. Such work waits here for a pause in the wheel instead, so the
 * cost lands on a frame nobody is watching move. Not forever: someone who keeps scrolling gets
 * it after `most` all the same. */

let last = 0;
const mark = (): void => { last = performance.now(); };
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

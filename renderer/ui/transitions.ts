/* Motion between one state of the window and the next.
 *
 * The browser can do this for us: hand it a DOM change and it animates the old picture into
 * the new one, matching up any elements that carry the same view-transition-name. Two things
 * use it here - moving between screens, and opening a mod card into its modal, where the
 * card's picture flies up and becomes the modal's.
 *
 * The catch is that the callback holds the frame: whatever runs inside it, the window is
 * frozen on the old picture until it finishes. So a transition is never wrapped around a
 * screen's data fetch, only around the paint that follows it. That is why a screen change
 * is armed here by the router and spent by whichever screen paints next, instead of the
 * router simply awaiting the render.
 *
 * Redrawing a screen in place - toggling a mod, ticking a row - deliberately gets nothing.
 * A crossfade there reads as a flicker, not as movement.
 */

const supported = typeof document.startViewTransition === 'function';
const stillness = window.matchMedia('(prefers-reduced-motion: reduce)');

// The router says a screen change is coming; the next paint spends it.
let running = 0;
// the screen change on show right now, and a press that landed on it rather than on the window
let current: ViewTransition | null = null;
let lost: { x: number; y: number; vt: ViewTransition } | null = null;
let armed = false;
// Screens keep their own element now, so somebody has to put the new one on screen. Doing
// it at switch time would show an empty screen for as long as the fetch takes, so it rides
// along with the paint instead and lands in the same frame as the markup.
let swap: (() => void) | null = null;

/**
 * Called by the router when the user asked for a different screen.
 * @param showPane swap the visible screen; runs first, inside the transition
 */
export function screenChanging(showPane?: () => void): void {
  armed = true;
  swap = showPane || null;
}

/**
 * Run a DOM update, animated if it is the paint of a screen change.
 *
 * **Await it.** An animated paint hands the markup to the browser, which writes it a frame
 * later, so until this promise settles the page still shows the old screen. A screen that
 * goes looking for its own elements before then finds the ones it just replaced: its buttons
 * are wired to markup nobody can click, and a list that renders into a container by id
 * throws outright. Both went unnoticed for a while because a machine asking for reduced
 * motion sends every paint down the synchronous branch, and that was the machine we tested on.
 *
 * @param update writes the new markup; must be synchronous
 * @returns settles once the markup is on the page
 */
export function paint(update: () => void): Promise<void> {
  const wanted = armed;
  const showPane = swap;
  armed = false;
  swap = null;
  const run = () => { if (showPane) showPane(); update(); };
  if (!wanted || !supported || stillness.matches) { run(); return Promise.resolve(); }
  // Counted, not a plain flag: starting a transition abandons any transition still running,
  // and that one's cleanup would otherwise strip the class off the transition replacing it -
  // which is exactly what happens when somebody clicks two tabs in a row.
  running++;
  document.documentElement.classList.add('vt-screen');
  const vt = document.startViewTransition(run);
  current = vt;
  // An abandoned or skipped transition rejects; that is a normal end here, not a fault to
  // report. Both promises: `ready` rejects too when a click cuts the animation short, and
  // uncaught it lands in the user's log through the unhandledrejection handler in app.js.
  vt.ready.catch(() => {});
  vt.finished.catch(() => {}).finally(() => {
    if (--running === 0) document.documentElement.classList.remove('vt-screen');
    if (current === vt) current = null;
  });
  // the update, not the animation: the screen carries on as soon as its markup exists
  return vt.updateCallbackDone;
}

/* While the browser animates a screen change it aims every click at the page root, so a tab
   pressed less than about 300 ms after another did nothing (found by the simulation, tools/sim,
   2026-09-24). Chromium here ignores pointer-events on ::view-transition, so the way through is
   by hand: a press on the root cuts the animation short, and its click goes to whatever is
   under the pointer once the new screen is up. Only a tab or a category: replaying a lost click
   there just finishes the move the user started, replaying one on Install would not be safe. */
document.addEventListener('pointerdown', (e) => {
  if (!current || e.target !== document.documentElement) return;
  lost = { x: e.clientX, y: e.clientY, vt: current };
  current.skipTransition();
}, true);
document.addEventListener('click', (e) => {
  if (!lost || e.target !== document.documentElement) return;
  const { x, y, vt } = lost;
  lost = null;
  vt.finished.catch(() => {}).finally(() => {
    const el = document.elementFromPoint(x, y)?.closest('.tb-tab, .rail-item');
    if (el instanceof HTMLElement) el.click();
  });
}, true);

/* A mod's window used to grow out of the card it was clicked on, as one named box the
   browser moved and resized. It was one movement on paper and two on screen: the picture
   travelled across the window while the frame did something else, and no amount of matching
   the curves fixed the impression. The window now opens where windows open and the picture
   arrives inside it - plain CSS, see the top of modal.css for the clock. */

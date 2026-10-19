/* Which hero the window is wearing.
 *
 * Eight palettes, the same eight the catalog's own site has, switched by clicking the mascot
 * in the title bar - h6rd let us bring both across (2026-08-01). The colours themselves live
 * in styles/themes.css; all this does is put the name on <html> and keep the picture in step.
 *
 * The mascots are animated GIFs from the catalog repository, listed there in GIF_CONFIG. We
 * fetch them the same way as every other picture in the app, so the first switch after a
 * fresh install needs the network and everything after it comes out of the cache.
 *
 * A ninth, 'secret', joins the round once ui/secret-lock.ts has been opened (settings `secret`).
 * What it wears follows the calendar (ui/season.ts): an event's own look while one is on, with
 * its dressing (ui/halloween.ts), and the rainbow the rest of the year. The rainbow wears all
 * eight in turn: every few seconds the mascot spins to the next hero and the accent goes with it,
 * the same spin the eight use, so it reads as the window that cannot pick one, not as a flicker.
 */
import { state } from '../core/store.ts';
import { RAW_BASE } from '../core/constants.ts';
import { tokenMs } from '../core/css-time.ts';
import { lookOn } from './season.ts';
import { dressHalloween } from './halloween.ts';

const HEROES = ['ursa', 'brew', 'fura', 'storm', 'invoker', 'meepo', 'bh', 'axe'];
const SECRET = 'secret';
/** how long the rainbow wears each hero */
const HUE_MS = 6000;

const unlocked = () => state.settings?.secret === true;
const themes = () => (unlocked() ? [...HEROES, SECRET] : HEROES);
/** the theme the window wears by name: the hero's, or 'secret' whatever look that has today */
let current = HEROES[0];

function mascotUrl(theme: string): string {
  const cfg = state.catalog?.constants?.GIF_CONFIG;
  const i = HEROES.indexOf(theme);
  const at = cfg?.themes?.indexOf(theme) ?? -1;
  const fromCatalog = at >= 0 ? cfg?.gifs?.[at] : null;
  return `${RAW_BASE}/${fromCatalog || `assets/previews/hueta/${HEROES[i < 0 ? 0 : i]}.gif`}`;
}

const setMascot = (hero: string) => {
  const img = document.querySelector<HTMLImageElement>('#themeMascot img');
  if (img) img.src = mascotUrl(hero);
};

// ---- the rainbow's round of the eight ----
let hueTimer = 0;
const stopHues = () => { clearInterval(hueTimer); hueTimer = 0; delete document.documentElement.dataset.hue; };
function startHues(): void {
  stopHues();
  let at = 0;
  document.documentElement.dataset.hue = HEROES[at];
  setMascot(HEROES[at]);
  // asked for less motion, it keeps the first and wears the rainbow only in its trim
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  hueTimer = window.setInterval(() => {
    if (document.hidden) return;
    at = (at + 1) % HEROES.length;
    const next = HEROES[at];
    spin(() => { document.documentElement.dataset.hue = next; setMascot(next); });
  }, HUE_MS);
}

/** Put a theme on the window. Unknown names, and a secret not yet earned, fall back to the one the app ships on. */
function applyTheme(name: unknown): string {
  const theme = typeof name === 'string' && themes().includes(name) ? name : HEROES[0];
  current = theme;
  const look = theme === SECRET ? lookOn(new Date()) : null;
  document.documentElement.dataset.theme = look ?? theme;
  if (look === 'rainbow') startHues();
  else { stopHues(); setMascot(look ? HEROES[0] : theme); }
  dressHalloween(look === 'halloween');
  return theme;
}

/** Wear the secret theme now: the pumpkin calls this the moment its lock opens. */
export function wearSecret(): void {
  window.api.settings.set('theme', applyTheme(SECRET));
}

/* The spin has to end on a clock, not only on its own event.
 *
 * `spinning` is what stops a second click landing mid-turn, and it used to come off in
 * animationend alone. Turn animations off in Windows and the stylesheet answers with
 * `animation: none !important` for everything, so the animation never runs, the event
 * never fires, and the class stays on the button forever: the colour changed once and the
 * mascot was dead for the rest of the session. Reported by somebody who had exactly that
 * setting, and it would have been every such person.
 *
 * So the timer is the guarantee and the event is only the early finish. Both call the same
 * idempotent pair, so whichever arrives first is the one that counts.
 */
function spin(swapTo: () => void): void {
  const mascot = document.querySelector<HTMLElement>('#themeMascot');
  if (!mascot || mascot.classList.contains('spinning')) { swapTo(); return; }
  // The hero turns away and the new one turns back: the window changes colour at the point
  // of the spin where the face is smallest, so the two look like one event rather than a
  // recolour with a spin thrown over it. Same trick the catalog's own site uses.
  mascot.classList.add('spinning');
  let swapped = false;
  const swap = () => { if (!swapped) { swapped = true; swapTo(); } };
  const end = () => {
    clearTimeout(timer);
    mascot.removeEventListener('animationend', end);
    mascot.classList.remove('spinning');
    swap();
  };
  const ms = spinMs();
  setTimeout(swap, ms / 2);
  const timer = setTimeout(end, ms + 50);
  mascot.addEventListener('animationend', end);
}

export function initTheme(): void {
  applyTheme(state.settings?.theme);
  const mascot = document.querySelector<HTMLElement>('#themeMascot');
  if (!mascot) return;
  // the heroes worn by clicking, this session: once all eight have been, the title bar says so
  const worn = new Set([current]);
  mascot.addEventListener('click', () => {
    if (mascot.classList.contains('spinning')) return;
    const list = themes();
    const next = list[(list.indexOf(current) + 1) % list.length];
    spin(() => {
      applyTheme(next);
      window.api.settings.set('theme', next);
      worn.add(next);
      if (HEROES.every((h) => worn.has(h))) document.dispatchEvent(new Event('mm-all-heroes'));
    });
  });
}

// the length of the spin, read from the stylesheet so the two cannot drift apart
const spinMs = () => tokenMs('--dur-medium-long');

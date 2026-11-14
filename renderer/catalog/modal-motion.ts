/* The mod window growing out of the card it was opened from, and going back into it, as one motion
 * each way.
 *
 * It starts as the card: the card's width, the card's place, cut to the card's height, so the
 * window's picture sits exactly where the card's picture was. From there the frame opens out to
 * the window's size and place while the cut opens to the whole window, all on one clock. Closing
 * plays the same path backwards, shorter, into the card it came from.
 *
 * The clock starts only once the window has been drawn as the card. Measured on 2026-11-14: the
 * first two frames after a click took 66 and 50 ms (the window's first raster), and with the clock
 * already running the window skipped a third of its 320 ms path and arrived in a jump.
 *
 * The window drawn as the card is still not the card: its picture is cropped another way and the
 * card's name, heart and hover sit elsewhere. So the two cross-fade where they meet, the window
 * appearing over the card in the first part of the opening and dissolving into it in the last part
 * of the closing, rather than one being swapped for the other in a single frame.
 *
 * Without a card (a mod reached from a link), with the system asking for less motion, or with the
 * card gone from the screen by the time the window closes, the CSS motion in modal.css plays. */
import { animate } from 'motion';
import { dur, ease, stillness } from '../motion/tokens.ts';

const DIM = 'rgba(3, 3, 6, 0.7)';
const CLEAR = 'rgba(3, 3, 6, 0)';

/* Where the window comes from, for the entrance in modal.css (windowIn): a window that appears in
 * the middle no matter what was clicked is a window with no cause; one that grows out of the thing
 * you pressed keeps the two connected, the way Windows does it. The panel is centred by the
 * overlay, so the stylesheet needs only how far the card was from that centre. */
function placeFrom(panel: HTMLElement, card: Element | null): void {
  if (!card) {
    panel.style.removeProperty('--from-x');
    panel.style.removeProperty('--from-y');
    return;
  }
  const r = card.getBoundingClientRect();
  panel.style.setProperty('--from-x', `${Math.round(r.left + r.width / 2 - window.innerWidth / 2)}px`);
  panel.style.setProperty('--from-y', `${Math.round(r.top + r.height / 2 - window.innerHeight / 2)}px`);
}

/** The window drawn as the card: where it sits, its scale, and the cut down to the card's height. */
function asCard(panel: HTMLElement, card: Element): { transform: string; clipPath: string; open: string } | null {
  const from = card.getBoundingClientRect();
  if (!from.width || !from.height) return null;
  // measured without the motion's own styles, so a window caught mid-flight still lands right
  const to = panel.getBoundingClientRect();
  const s = from.width / to.width;
  // the cut is in the window's own units, before the scale: the card's height at this width
  const hidden = Math.max(0, to.height - from.height / s);
  // corners: the card's as seen at the card's size, opening to the window's own
  const cardRadius = (parseFloat(getComputedStyle(card).borderRadius) || 0) / s;
  const ownRadius = parseFloat(getComputedStyle(panel).borderRadius) || 0;
  return {
    transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`,
    clipPath: `inset(0px 0px ${hidden}px 0px round ${cardRadius}px)`,
    open: `inset(0px 0px 0px 0px round ${ownRadius}px)`,
  };
}

/** Two frames: the one that lays the window out and the one that puts it on screen. */
const painted = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

let run = 0;

/** Opens the window out of the card: as one motion here, or through modal.css when it cannot. */
export function growFrom(panel: HTMLElement, card: Element | null): void {
  const mine = ++run;
  placeFrom(panel, card);
  const overlay = panel.parentElement;
  panel.classList.remove('grows', 'returns');
  overlay?.classList.remove('grows', 'returns');
  clear(panel, ['transform', 'clip-path', 'opacity']);
  if (overlay) clear(overlay, ['background-color', 'backdrop-filter']);
  if (!card || stillness()) return;
  const start = asCard(panel, card);
  if (!start) return;
  panel.classList.add('grows');
  overlay?.classList.add('grows');
  // drawn as the card from the first frame, so it is never see-through and never somewhere else
  panel.style.transform = start.transform;
  panel.style.clipPath = start.clipPath;
  panel.style.opacity = '0';
  if (overlay) {
    overlay.style.backgroundColor = CLEAR;
    overlay.style.backdropFilter = 'blur(0px)';
  }
  void painted().then(() => {
    if (mine !== run) return;
    const clock = { duration: dur('--dur-slow'), ease: ease('--ease-standard') };
    // only the room behind the window dims, where the overlay used to fade in whole, window and all
    if (overlay) {
      animate(overlay, { backgroundColor: [CLEAR, DIM], backdropFilter: ['blur(0px)', 'blur(8px)'] }, clock)
        .finished.then(() => { if (mine === run) settle(overlay, ['background-color', 'backdrop-filter']); }).catch(() => {});
    }
    animate(panel, { opacity: [0, 1] }, { duration: clock.duration * 0.3, ease: 'linear' }).finished.catch(() => {});
    animate(panel, { transform: [start.transform, 'translate(0px, 0px) scale(1)'], clipPath: [start.clipPath, start.open] }, clock)
      .finished.then(() => { if (mine === run) settle(panel, ['transform', 'clip-path', 'opacity']); }).catch(() => {});
  });
}

/* Once it has landed the window hands its look back to the stylesheet. A transform left on it,
 * even the identity one, keeps it on a layer of its own, and text there is antialiased in grey
 * instead of the way the rest of the window draws it: every glyph came out a shade off. */
function settle(el: HTMLElement, props: string[]): void {
  // a frame later: Motion writes the final values back after its promise settles
  requestAnimationFrame(() => clear(el, props));
}

function clear(el: HTMLElement, props: string[]): void {
  for (const p of props) el.style.removeProperty(p);
}

/** Whether the card is still where the eye can follow the window back to it. */
function onScreen(card: Element | null): card is Element {
  if (!card?.isConnected) return false;
  const r = card.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
}

/**
 * Closes the window back into its card, on the opening's path played backwards. Returns false when
 * it cannot (no card on screen, the window scrolled, less motion asked for): the CSS exit plays then.
 */
export function shrinkAway(panel: HTMLElement, card: Element | null = null): boolean {
  const mine = ++run;
  const overlay = panel.parentElement;
  panel.classList.remove('grows');
  overlay?.classList.remove('grows');
  // a window scrolled down would fold its own middle into the card's picture
  const back = onScreen(card) && panel.scrollTop < 4 && !stillness();
  const end = back ? (clear(panel, ['transform', 'clip-path', 'opacity']), asCard(panel, card)) : null;
  if (!end) {
    panel.classList.remove('returns');
    overlay?.classList.remove('returns');
    clear(panel, ['transform', 'clip-path', 'opacity']);
    if (overlay) clear(overlay, ['background-color', 'backdrop-filter']);
    return false;
  }
  panel.classList.add('returns');
  overlay?.classList.add('returns');
  const clock = { duration: dur('--dur-base'), ease: ease('--ease-standard') };
  if (overlay) animate(overlay, { backgroundColor: [DIM, CLEAR], backdropFilter: ['blur(8px)', 'blur(0px)'] }, clock).finished.catch(() => {});
  void mine;
  animate(panel, { transform: ['translate(0px, 0px) scale(1)', end.transform], clipPath: [end.open, end.clipPath] }, clock).finished.catch(() => {});
  // gone by the time it lands, so the card under it is what is left, not a swap
  animate(panel, { opacity: [1, 0] }, { duration: clock.duration * 0.4, delay: clock.duration * 0.6, ease: 'linear' }).finished.catch(() => {});
  return true;
}

/** After the window is hidden: nothing of either motion is left on it for the next opening. */
export function reset(panel: HTMLElement): void {
  run++;
  const overlay = panel.parentElement;
  panel.classList.remove('grows', 'returns');
  overlay?.classList.remove('grows', 'returns');
  clear(panel, ['transform', 'clip-path', 'opacity']);
  if (overlay) clear(overlay, ['background-color', 'backdrop-filter']);
}

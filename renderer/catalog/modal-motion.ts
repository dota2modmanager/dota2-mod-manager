/* The mod window growing out of the card it was opened from, as one motion.
 *
 * It starts as the card: the card's width, the card's place, cut to the card's height, so the
 * window's picture sits exactly where the card's picture was. From there the frame opens out to
 * the window's size and place while the cut opens to the whole window, all on one clock. The
 * version taken out before let the picture grow on its own clock inside a window that was doing
 * something else; here the picture does not move inside the frame at all.
 *
 * Without a card (a mod reached from a link) or with the system asking for less motion, the CSS
 * entrance in modal.css plays as it did. */
import { animate } from 'motion';
import { dur, ease, stillness } from './motion.ts';

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

/** Opens the window out of the card: as one motion here, or through modal.css when it cannot. */
export function growFrom(panel: HTMLElement, card: Element | null): void {
  placeFrom(panel, card);
  const overlay = panel.parentElement;
  panel.classList.remove('grows');
  overlay?.classList.remove('grows');
  if (!card || stillness()) return;
  const from = card.getBoundingClientRect();
  if (!from.width) return;
  panel.classList.add('grows');
  // the window is the card from its first frame, so it is never see-through: only the room
  // behind it dims, where the overlay used to fade in whole, window and all
  if (overlay) {
    overlay.classList.add('grows');
    animate(overlay, { backgroundColor: ['rgba(3, 3, 6, 0)', 'rgba(3, 3, 6, 0.7)'], backdropFilter: ['blur(0px)', 'blur(8px)'] },
      { duration: dur('--dur-slow'), ease: ease('--ease-standard') })
      .finished.then(() => settle(overlay, ['background-color', 'backdrop-filter'])).catch(() => {});
  }
  const to = panel.getBoundingClientRect();
  const s = from.width / to.width;
  // the cut is in the window's own units, before the scale: the card's height at this width
  const hidden = Math.max(0, to.height - from.height / s);
  // corners: the card's as seen at the card's size, opening to the window's own
  const cardRadius = (parseFloat(getComputedStyle(card).borderRadius) || 0) / s;
  const ownRadius = parseFloat(getComputedStyle(panel).borderRadius) || 0;
  animate(panel, {
    transform: [`translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`, 'translate(0px, 0px) scale(1)'],
    clipPath: [`inset(0px 0px ${hidden}px 0px round ${cardRadius}px)`, `inset(0px 0px 0px 0px round ${ownRadius}px)`],
  }, { duration: dur('--dur-slow'), ease: ease('--ease-standard') })
    .finished.then(() => settle(panel, ['transform', 'clip-path'])).catch(() => {});
}

/* Once it has landed the window hands its look back to the stylesheet. A transform left on it,
 * even the identity one, keeps it on a layer of its own, and text there is antialiased in grey
 * instead of the way the rest of the window draws it: every glyph came out a shade off. */
function settle(el: HTMLElement, props: string[]): void {
  // a frame later: Motion writes the final values back after its promise settles
  requestAnimationFrame(() => {
    for (const p of props) el.style.removeProperty(p);
  });
}

/** Closing plays the CSS exit; the class that turned the entrance off would hold it back too. */
export function shrinkAway(panel: HTMLElement): void {
  panel.classList.remove('grows');
  panel.parentElement?.classList.remove('grows');
  panel.style.removeProperty('transform');
  panel.style.removeProperty('clip-path');
}

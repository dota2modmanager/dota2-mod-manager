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

export function growFrom(panel: HTMLElement, card: Element | null): void {
  panel.classList.remove('grows');
  if (!card || stillness()) return;
  const from = card.getBoundingClientRect();
  if (!from.width) return;
  panel.classList.add('grows');
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
  }, { duration: dur('--dur-medium-long'), ease: ease('--ease-decelerate') });
}

/** Closing plays the CSS exit; the class that turned the entrance off would hold it back too. */
export function shrinkAway(panel: HTMLElement): void {
  panel.classList.remove('grows');
  panel.style.removeProperty('transform');
  panel.style.removeProperty('clip-path');
}

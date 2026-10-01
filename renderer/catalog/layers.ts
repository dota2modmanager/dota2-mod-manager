/* The catalog pane, in three layers while the screens move to React.
 *
 * Banners (a notice, the missing-game warning) sit on top and are rewritten on every draw. Below
 * them is either React's screen (catalog/screen/) or the legacy layer, where the screens that
 * still write markup draw: a cosmetic slot and the item builder. Only one of the two holds
 * anything at a time, so a query for the title or the cards finds the screen on show. */
import { pane } from '../core/router.js';

const root: HTMLElement = pane('catalog');

function layer(id: string): HTMLElement {
  let el = root.querySelector<HTMLElement>(`#${id}`);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    root.append(el);
  }
  return el;
}

// created in this order once, so the banners come first
const bannersEl = layer('catalogBanners');
const screenEl = layer('catalogScreen');
const legacyEl = layer('catalogLegacy');

let onLeaveScreen: () => void = () => {};

/** What React's screen does when a legacy screen takes the pane: draw nothing. */
export function whenScreenLeaves(fn: () => void): void {
  onLeaveScreen = fn;
}

export const bannerLayer = (): HTMLElement => bannersEl;

/** The layer React draws into; the legacy one is emptied so its old title and cards are gone. */
export function screenLayer(): HTMLElement {
  if (legacyEl.firstChild) legacyEl.replaceChildren();
  return screenEl;
}

/** The layer a legacy screen writes into; React's screen draws nothing while it is on show. */
export function legacyLayer(): HTMLElement {
  if (screenEl.firstChild) onLeaveScreen();
  return legacyEl;
}

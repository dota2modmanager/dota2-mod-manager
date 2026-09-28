/* The catalog pane, in two layers. Banners (a notice, the missing-game warning) sit on top and are
 * rewritten on every draw; below them is React's screen (catalog/screen/). */
import { pane } from '../core/router.ts';

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

export const bannerLayer = (): HTMLElement => bannersEl;
export const screenLayer = (): HTMLElement => screenEl;

/* The mod window's content, in two layers while the windows move to React.
 *
 * One overlay serves three windows: a mod (React, ModModal.tsx), a free cosmetic and the item
 * builder's pickers (still markup). Each writes into its own layer inside #modalContent, and only
 * one layer holds anything at a time. The layers take no room of their own (display: contents in
 * modal.css), so the window's styles see the same children they always did. */

const panel = document.getElementById('modalContent') as HTMLElement;

function layer(id: string): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'modal-layer';
    panel.append(el);
  }
  return el;
}

const reactEl = layer('modalReact');
const legacyEl = layer('modalLegacy');

let onLeave: () => void = () => {};

/** What the React window does when a markup window takes the overlay: draw nothing. */
export function whenReactModalLeaves(fn: () => void): void {
  onLeave = fn;
}

/** The layer the mod window draws into; a markup window's leftovers go first. */
export function reactModalLayer(): HTMLElement {
  if (legacyEl.firstChild) legacyEl.replaceChildren();
  return reactEl;
}

/** The layer a markup window writes into (a cosmetic, the item builder's pickers). */
export function legacyModalLayer(): HTMLElement {
  if (reactEl.firstChild) onLeave();
  return legacyEl;
}

/** Both emptied, once the window has closed. */
export function clearModal(): void {
  legacyEl.replaceChildren();
  onLeave();
}

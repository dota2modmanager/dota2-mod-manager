/* The one overlay every catalog window opens in: a mod's, a free look's, the item builder's.
 * One holds it at a time. Each says here how it lets go, and it lets go when another window takes
 * the overlay or once the overlay has closed.
 *
 * The window grows out of the card it was opened from (catalog/modal-motion.ts). Timings live in
 * modal.css; the only number needed here is when the exit is over, read rather than repeated so
 * the stylesheet stays the one place the tempo is set, and so the system's reduced-motion setting,
 * which flattens it to 1ms, is honoured for free. */
import { tokenMs } from '../../core/css-time.js';
import { growFrom, shrinkAway } from '../../catalog/modal-motion.ts';
import { clearModal } from '../../catalog/modal/root.tsx';

const overlay = document.getElementById('modalOverlay') as HTMLElement;
const panel = document.getElementById('modalContent') as HTMLElement;

type LetGo = () => void;
const holders = new Set<LetGo>();

/** A window that opens in the overlay says how it lets go of it. */
export function sharesOverlay(letGo: LetGo): void {
  holders.add(letGo);
}

/** Whatever held the overlay lets go of it: a window is about to draw in it. */
export function takeOverlay(): void {
  for (const letGo of holders) letGo();
}

let closingTimer = 0;

/** Draw a window and grow it out of the card it was opened from, or out of the middle with none. */
export function openOverlay(draw: () => void, from: Element | null): void {
  clearTimeout(closingTimer);
  overlay.classList.remove('closing');
  draw();
  overlay.classList.remove('hidden');
  growFrom(panel, from);
}

export function closeOverlay(): void {
  if (overlay.classList.contains('hidden')) return;
  overlay.classList.add('closing');
  shrinkAway(panel);
  clearTimeout(closingTimer);
  closingTimer = window.setTimeout(() => {
    // reopened while it was falling: that pass owns the overlay now
    if (!overlay.classList.contains('closing')) return;
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    clearModal();
    takeOverlay();
  }, tokenMs('--dur-base'));
}

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeOverlay();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeOverlay();
});

/* What a keyboard and a screen reader need from the window, done in one place rather than by
 * every window that opens over it. All three were found by the accessibility walk
 * (tools/sim/scenarios/a11y.js), which presses Tab, Enter and Escape and reads the tree a screen
 * reader reads.
 *
 * A window over the app takes the focus when it opens, keeps it while it is open (Tab and
 * Shift+Tab go round inside it), and hands it back to whatever opened it when it closes. Without
 * that, Tab walked out of a mod's window into the cards behind it, and Escape left the focus on
 * nothing, so the next Tab started again from the top of the page.
 *
 * Each such window is a dialog to a screen reader: role="dialog", aria-modal, and named by its
 * title. A window that already says what it is (the safe-mode question, the 18+ question) keeps
 * what it says.
 *
 * An icon is a picture. Material Symbols draws one from a word, so to a screen reader the
 * "Installed" chip was "check_circle Installed" and the rail's arrow was "chevron_left". Every .ms
 * is hidden from it; a button that is only an icon is named by its aria-label or title, and the
 * walk fails on one that is not.
 *
 * The windows are found by what they are rather than registered one by one: a .confirm-overlay or
 * a .player-overlay put on the page, and #modalOverlay or #queueOverlay shown and hidden.
 */

import { wrapTarget } from './focus-wrap.ts';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(', ');
/** Windows put on the page when they open and taken off when they close. */
const ADDED = '.confirm-overlay, .player-overlay';
/** Windows that are always there and shown by losing "hidden". */
const TOGGLED = ['modalOverlay', 'queueOverlay'];
/** The part of a window that is the dialog, inside the dimmed backdrop. */
const BOX = '.confirm-box, .modal-content, .queue-panel, .player-box';

type Held = { overlay: HTMLElement; box: HTMLElement; opener: HTMLElement | null };
const held: Held[] = [];
let uid = 0;
/* The last few things that had the focus, newest last. A dialog may focus its own button before
   this module hears it opened (confirmDialog does, synchronously), so what opened it is the newest
   one outside it, not whatever has the focus by then. */
const recent: HTMLElement[] = [];

/** What Tab can land on inside `box`, in order: shown, enabled, not inert. */
export function focusables(box: Element): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert], [hidden]'));
}

function nameDialog(box: HTMLElement): void {
  if (!box.hasAttribute('role')) box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  if (box.hasAttribute('aria-labelledby') || box.hasAttribute('aria-label')) return;
  const title = box.querySelector<HTMLElement>('h1, h2, h3, .modal-title, .confirm-title, .queue-title, .confirm-msg');
  if (!title) return;
  if (!title.id) title.id = `dialog-title-${++uid}`;
  box.setAttribute('aria-labelledby', title.id);
}

function hold(overlay: HTMLElement): void {
  if (held.some((h) => h.overlay === overlay)) return;
  const box = overlay.querySelector<HTMLElement>(BOX) || overlay;
  const opener = [...recent].reverse().find((el) => el.isConnected && !overlay.contains(el)) || null;
  held.push({ overlay, box, opener });
  /* The window draws its content just after it opens (React commits on a later task, an
     innerHTML right away), so look a few times until something focusable is there. Timers, not
     animation frames: a window that is not on screen draws no frames, and an automated run keeps
     its window off the screen. */
  let tries = 0;
  const settle = () => {
    if (!held.some((h) => h.overlay === overlay)) return;
    nameDialog(box);
    if (box.contains(document.activeElement)) return; // the window chose where the focus goes
    const first = focusables(box)[0];
    if (first) { first.focus({ preventScroll: true }); return; }
    if (++tries < 10) { setTimeout(settle, 30); return; }
    box.tabIndex = -1;
    box.focus({ preventScroll: true });
  };
  setTimeout(settle, 0);
}

function release(overlay: HTMLElement): void {
  const i = held.findIndex((h) => h.overlay === overlay);
  if (i < 0) return;
  const [{ box, opener }] = held.splice(i, 1);
  const now = document.activeElement;
  // only when the focus went with the window: a click elsewhere meanwhile is the user's choice
  const lost = !now || now === document.body || !now.isConnected || box.contains(now) || overlay.contains(now);
  if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
}

let iconsQueued = false;
function hideIcons(): void {
  if (iconsQueued) return;
  iconsQueued = true;
  setTimeout(() => {
    iconsQueued = false;
    for (const el of document.querySelectorAll('.ms:not([aria-hidden])')) el.setAttribute('aria-hidden', 'true');
  }, 0);
}

/** Start watching the page. Once, at startup (renderer/app.ts). */
export function initA11y(): void {
  document.addEventListener('focusin', (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    recent.push(e.target);
    if (recent.length > 8) recent.shift();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !held.length) return;
    const { box } = held[held.length - 1];
    const items = focusables(box);
    const at = document.activeElement instanceof HTMLElement && box.contains(document.activeElement) ? document.activeElement : null;
    if (!items.length) { e.preventDefault(); return; }
    const to = wrapTarget(items, at, e.shiftKey);
    if (to) { e.preventDefault(); to.focus(); }
  }, true);

  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) if (n instanceof HTMLElement && n.matches(ADDED)) hold(n);
      for (const n of r.removedNodes) if (n instanceof HTMLElement && n.matches(ADDED)) release(n);
      if (r.addedNodes.length) hideIcons();
    }
  }).observe(document.body, { childList: true, subtree: true });

  for (const id of TOGGLED) {
    const el = document.getElementById(id);
    if (!el) continue;
    new MutationObserver(() => {
      const open = !el.classList.contains('hidden') && !el.classList.contains('closing');
      if (open) hold(el); else release(el);
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  hideIcons();
}

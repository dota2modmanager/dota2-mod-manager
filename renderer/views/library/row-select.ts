/* Picking rows in My mods with the keyboard's help, as in Windows Explorer (a request from the
 * Discord: the ticks at the left edge are a small target down a list of forty mods).
 *
 *   Ctrl+click a row     tick or untick it
 *   Shift+click a row    tick every row from the last one clicked (library/selection.ts clickSelect)
 *   Ctrl+A               tick every mod and look the search shows
 *   Escape               take every tick off
 *   Delete               remove the ticked ones, after the same question the bulk bar asks
 *
 * A click on a switch, a button or a link inside the row still does only that. The keys work only
 * while My mods is on screen, nothing is typed into a field, and no window is open over it. */
import { state } from '../../core/store.ts';
import { pane } from '../../core/router.ts';
import { overlayOpen } from '../../ui/hotkeys.ts';
import { clickSelect, selectableCosmetics, selectableMods } from '../../library/selection.ts';
import { lib, screen } from './state.ts';

let anchor = '';

const CONTROLS = 'button, a, input, select, textarea, label, [role="switch"], [data-drag]';
const order = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLInputElement>('.lib-check[data-check]')].map((b) => b.dataset.check || '');

function rowKey(el: HTMLElement): string {
  const row = el.closest<HTMLElement>('.member-row, .lib-row');
  return row?.querySelector<HTMLInputElement>('.lib-check[data-check]')?.dataset.check || '';
}

const typing = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

/** Wire the screen once; `remove` is the bulk bar's own removal, question and all. */
export function bindRowSelect(remove: () => void): void {
  const root = pane('library');

  // Shift with the button down would otherwise paint a text selection across the rows
  root.addEventListener('mousedown', (e) => {
    if (e.shiftKey && (e.target as HTMLElement).closest('.lib-row, .member-row')) e.preventDefault();
  });

  // capture: a Shift-click on a tick box is a range, and the box must not flip on its own first
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const ctrl = e.ctrlKey || e.metaKey;
    const onBox = target.matches('.lib-check[data-check]');
    if (!onBox && !ctrl && !e.shiftKey) return;
    const key = onBox ? (target as HTMLInputElement).dataset.check || '' : rowKey(target);
    if (!key) return;
    if (onBox && !e.shiftKey) { anchor = key; return; } // a plain tick: React flips it, and it is the new anchor
    if (!onBox && target.closest(CONTROLS)) return;
    e.preventDefault();
    e.stopPropagation();
    anchor = clickSelect(lib.sel, order(root), anchor, key, { ctrl, shift: e.shiftKey });
    screen.draw();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (state.view !== 'library' || overlayOpen() || typing()) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      for (const id of [...selectableMods(lib.records, lib.search), ...selectableCosmetics(lib.records, lib.search)]) lib.sel.add(id);
      screen.draw();
    } else if (e.key === 'Escape' && lib.sel.size) {
      lib.sel.clear();
      anchor = '';
      screen.draw();
    } else if (e.key === 'Delete' && lib.sel.size) {
      e.preventDefault();
      remove();
    }
  });
}

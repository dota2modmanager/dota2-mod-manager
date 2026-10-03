/* The menu that opens on a right-click.
 *
 * Rows in this app can do more than fits on them: a mod can be exported, moved through the
 * load order, taken apart, thrown away. Printing all of that on every row turns a list into
 * a control panel, and most of those buttons are pressed once a year. So the row keeps what
 * is used - the switch and the delete - and everything else waits under the right button,
 * where a desktop user already looks for it.
 *
 * One menu exists at a time and it is owned by this module: opening another closes the first,
 * and anything that moves the page underneath (a scroll, a click, Escape, the window losing
 * focus) closes it too, because a menu pinned to a row that has scrolled away is a menu
 * pointing at the wrong thing.
 */
import { esc } from './format.ts';

export interface MenuItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  onPick?: () => void;
  separator?: boolean;
}

let host: HTMLElement | null = null;

function closeMenu(): void {
  host?.remove();
  host = null;
}

/** x and y are the viewport coordinates of the click. A falsy entry is a row left out. */
function openMenu(items: (MenuItem | false | null | undefined)[], x: number, y: number): void {
  closeMenu();
  const live = items.filter((item): item is MenuItem => Boolean(item));
  if (!live.length) return;

  const menu = document.createElement('div');
  host = menu;
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = live.map((item, i) => (item.separator
    ? '<div class="ctx-sep"></div>'
    : `<button class="ctx-item ${item.danger ? 'danger' : ''}" data-i="${i}" role="menuitem" ${item.disabled ? 'disabled' : ''}>
         <span class="ms">${esc(item.icon || '')}</span><span>${esc(item.label)}</span>
       </button>`)).join('');
  document.body.appendChild(menu);

  // keep it on screen: a row near the bottom edge would otherwise open a menu into nowhere
  const r = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - r.width - 8);
  const top = Math.min(y, window.innerHeight - r.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  menu.querySelectorAll<HTMLElement>('.ctx-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = live[Number(btn.dataset.i)];
      closeMenu();
      item.onPick?.();
    });
  });
}

// Closing is global and permanent: the listeners are registered once, not per menu, so a
// menu can never outlive the thing it belongs to.
document.addEventListener('mousedown', (e) => { if (host && !host.contains(e.target as Node)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);
document.addEventListener('scroll', closeMenu, true);

/**
 * Right-click anywhere inside `root` that lands on `selector` opens the menu that `itemsFor`
 * builds for that element. Returning nothing means this row has nothing to offer, and the
 * browser's own menu is left alone.
 */
export function bindContextMenu(root: HTMLElement, selector: string,
  itemsFor: (el: HTMLElement, e: MouseEvent) => (MenuItem | false | null | undefined)[] | null | undefined): void {
  root.addEventListener('contextmenu', (e) => {
    const el = (e.target as Element).closest<HTMLElement>(selector);
    if (!el || !root.contains(el)) return;
    const items = itemsFor(el, e);
    if (!items || !items.length) return;
    e.preventDefault();
    openMenu(items, e.clientX, e.clientY);
  });
}

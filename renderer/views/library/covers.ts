/* Who covers a mod, file by file (issue #415). The "covered" pill on a row said that some other
 * mod wins its files and named it; it did not say which files, and the fix (load this one first)
 * was a guess in the row's menu. Clicking the pill opens this window: each mod that wins files
 * from this one, how many and which, and a button that moves this mod above it when both have a
 * place in the load order. A file somebody dropped into the folder by hand has no place to move
 * to, so it gets the list and no button. */
import { esc } from '../../ui/format.ts';
import { catalogName } from '../../ui/catalog-name.ts';
import { loadOrder } from '../../library/order.ts';
import type { Cover } from '../../library/types.ts';
import { lib } from './state.ts';

/** How many paths the window lists under a winner before it says how many more there are. */
const SHOWN = 30;

/** The row a key names, managed or foreign, with what covers it. */
function rowFor(key: string): { name: string; coveredBy: Cover[]; movable: boolean } | null {
  const rec = lib.records.find((r) => r.id === key);
  if (rec) return { name: rec.name, coveredBy: rec.coveredBy || [], movable: true };
  const f = lib.external.find((x) => x.key === key);
  return f ? { name: f.name, coveredBy: f.coveredBy || [], movable: false } : null;
}

/** The window's markup: one block per winner, a move button where canMove says one fits. */
export function coversHtml(name: string, covers: Cover[], canMove: (c: Cover) => boolean): string {
  const blocks = covers.map((c, i) => {
    const paths = c.paths || [];
    const more = c.files - Math.min(paths.length, SHOWN);
    return `
      <div class="cover-block">
        <div class="cover-head">
          <span class="cover-winner">${esc(catalogName(c.name))}</span>
          <span class="cover-count">${esc(L`файлов: ${c.files}`)}</span>
          ${canMove(c) ? `<button class="btn btn-sm" data-cover="${i}">${esc(L`Загружать раньше него`)}</button>` : ''}
        </div>
        <details class="cover-paths"${covers.length === 1 ? ' open' : ''}>
          <summary>${esc(L`Какие файлы`)}</summary>
          <ul>${paths.slice(0, SHOWN).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
          ${more > 0 ? `<div class="cover-more">${esc(L`и ещё ${more}`)}</div>` : ''}
        </details>
      </div>`;
  }).join('');
  return `
    <div class="confirm-box cover-box" role="dialog" aria-modal="true" aria-labelledby="coverTitle">
      <div class="tool-head">
        <span class="ms">layers</span>
        <div>
          <div class="tool-title" id="coverTitle">${esc(L`Кто перекрывает «${catalogName(name)}»`)}</div>
          <div class="tool-sub">${esc(L`Игра берёт файл у мода, который загружается раньше. Остальные копии этого файла она не видит.`)}</div>
        </div>
      </div>
      <div class="cover-list">${blocks}</div>
      <div class="confirm-actions"><button class="btn" data-c="close">${esc(L`Закрыть`)}</button></div>
    </div>`;
}

/**
 * Open the window for the row this key names; resolves to the load-order index to move it to,
 * or null when the user only looked.
 */
export function showCovers(key: string): Promise<number | null> {
  const row = rowFor(key);
  if (!row || !row.coveredBy.length) return Promise.resolve(null);
  const order = loadOrder(lib.records);
  const target = (c: Cover) => (row.movable && c.key && order.has(key) ? order.get(c.key)?.index ?? null : null);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = coversHtml(row.name, row.coveredBy, (c) => target(c) !== null);
    document.body.appendChild(overlay);
    const done = (v: number | null) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(null); };
    overlay.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === overlay || el.closest('[data-c="close"]')) { done(null); return; }
      const btn = el.closest<HTMLElement>('[data-cover]');
      if (btn) done(target(row.coveredBy[Number(btn.dataset.cover)]));
    });
    document.addEventListener('keydown', onKey);
    overlay.querySelector<HTMLElement>('[data-c="close"]')?.focus();
  });
}

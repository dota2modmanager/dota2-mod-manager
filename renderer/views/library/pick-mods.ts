/* The window that asks which mods to put into a pack: standalone mods, each with a tick, and one
 * box that ticks them all. Resolves with the chosen ids, or null. */
import { esc } from '../../ui/format.js';
import { toast } from '../../ui/toast.js';

export interface Candidate { id: string; name: string; sub: string }

export function pickModsDialog(candidates: Candidate[], { title = L`Выбери моды`, okLabel = L`Готово` } = {}): Promise<string[] | null> {
  return new Promise((resolve) => {
    if (!candidates.length) { toast(L`Нет отдельных модов для добавления`, 'warn'); resolve(null); return; }
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box wide">
        <div class="confirm-msg">${esc(title)}</div>
        <div class="pick-head">
          <label class="lib-selectall"><input type="checkbox" class="lib-check" id="pickSelAll">${L`Выбрать всё`}</label>
          <span class="pick-count" id="pickCount"></span>
        </div>
        <div class="pick-list">
          ${candidates.map((c) => `
            <label class="pick-row">
              <input type="checkbox" class="lib-check" value="${esc(c.id)}">
              <span class="pick-name">${esc(c.name)}</span>
              <span class="pick-sub">${esc(c.sub || '')}</span>
            </label>`).join('')}
        </div>
        <div class="confirm-actions">
          <button class="btn" data-c="no">${L`Отмена`}</button>
          <button class="btn btn-primary" data-c="yes">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    // scoped to the list, so the "select all" box above it is never counted as a candidate
    const boxes = [...overlay.querySelectorAll<HTMLInputElement>('.pick-list .lib-check')];
    const selAll = overlay.querySelector('#pickSelAll') as HTMLInputElement;
    const countEl = overlay.querySelector('#pickCount') as HTMLElement;
    const sync = () => {
      const n = boxes.filter((b) => b.checked).length;
      countEl.textContent = `${n} / ${boxes.length}`;
      selAll.checked = n === boxes.length;
      selAll.indeterminate = n > 0 && n < boxes.length;
    };
    selAll.addEventListener('change', () => { boxes.forEach((b) => { b.checked = selAll.checked; }); sync(); });
    boxes.forEach((b) => b.addEventListener('change', sync));
    sync();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(null); };
    const done = (v: string[] | null) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    overlay.querySelector('[data-c="no"]')?.addEventListener('click', () => done(null));
    overlay.querySelector('[data-c="yes"]')?.addEventListener('click', () => {
      const ids = boxes.filter((b) => b.checked).map((b) => b.value);
      done(ids.length ? ids : null);
    });
    document.addEventListener('keydown', onKey);
  });
}

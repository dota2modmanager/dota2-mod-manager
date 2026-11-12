/* What a Dota update did to one mod (issue #416). The "pre-patch" pill said how many of the mod's
 * files Valve changed or took away; clicking it opens this window: which files, and the step that
 * fits. A catalog mod with a newer file is updated in its slot, any other can be switched off, and
 * when it still looks right in the game the mark comes off. The patch banner keeps its one action:
 * the choice is per mod, so it lives on the mod. */
import { esc } from '../../ui/format.ts';
import { catalogName } from '../../ui/catalog-name.ts';
import type { LibRecord } from '../../library/types.ts';
import { recById } from './state.ts';

/** What the window was closed with. */
export type PrePatchChoice = 'update' | 'off' | 'fine' | null;

/** How many paths a list shows before it says how many more there are. */
const SHOWN = 30;

function pathList(title: string, paths: string[], total: number, open: boolean): string {
  if (!total) return '';
  const more = total - Math.min(paths.length, SHOWN);
  return `
    <details class="cover-paths"${open ? ' open' : ''}>
      <summary>${esc(title)}</summary>
      <ul>${paths.slice(0, SHOWN).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      ${more > 0 ? `<div class="cover-more">${esc(L`и ещё ${more}`)}</div>` : ''}
    </details>`;
}

/** The window's markup for a record with a pre-patch mark. */
export function prePatchHtml(rec: LibRecord): string {
  const p = rec.prePatch || { since: null, changed: 0, removed: 0 };
  const build = p.since ? ` ${p.since}` : '';
  const buttons = [
    rec.updateAvailable ? `<button class="btn btn-primary" data-c="update">${esc(L`Обновить мод`)}</button>`
      : rec.enabled ? `<button class="btn" data-c="off">${esc(L`Выключить`)}</button>` : '',
    `<button class="btn" data-c="fine">${esc(L`В игре всё в порядке`)}</button>`,
    `<button class="btn" data-c="close">${esc(L`Закрыть`)}</button>`,
  ].join('');
  const advice = rec.updateAvailable
    ? L`У автора есть новая версия: обнови мод, он встанет на то же место.`
    : L`Новой версии в каталоге нет. Если в игре что-то сломалось, выключи мод и напиши автору, какие файлы поменялись.`;
  return `
    <div class="confirm-box cover-box" role="dialog" aria-modal="true" aria-labelledby="preTitle">
      <div class="tool-head">
        <span class="ms">history</span>
        <div>
          <div class="tool-title" id="preTitle">${esc(L`Что патч задел в «${catalogName(rec.name)}»`)}</div>
          <div class="tool-sub">${esc(L`Dota${build} обновила файлы, которые подменяет этот мод. Мод возвращает их старые версии.`)} ${esc(advice)}</div>
        </div>
      </div>
      <div class="cover-list">
        <div class="cover-block">
          ${pathList(L`Изменены: ${p.changed}`, p.changedPaths || [], p.changed, !p.removed)}
          ${pathList(L`Убраны из игры: ${p.removed}`, p.removedPaths || [], p.removed, !p.changed)}
        </div>
      </div>
      <div class="confirm-actions">${buttons}</div>
    </div>`;
}

/** Open the window for a record; resolves to what the user chose. */
export function showPrePatch(id: string): Promise<PrePatchChoice> {
  const rec = recById(id);
  if (!rec || !rec.prePatch) return Promise.resolve(null);
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = prePatchHtml(rec);
    document.body.appendChild(overlay);
    const done = (v: PrePatchChoice) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(null); };
    overlay.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el === overlay) { done(null); return; }
      const c = el.closest<HTMLElement>('[data-c]')?.dataset.c;
      if (c === 'close') done(null);
      else if (c === 'update' || c === 'off' || c === 'fine') done(c);
    });
    document.addEventListener('keydown', onKey);
    overlay.querySelector<HTMLElement>('[data-c="close"]')?.focus();
  });
}

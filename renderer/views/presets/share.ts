/* Sharing a preset, in two windows. The first offers both ways and says how they differ: a link
 * is a few hundred characters and installs from the catalog on the other end, and cannot carry a
 * mod the catalog does not have; a file carries anything, and can run to hundreds of megabytes.
 * The second is the file's pre-flight: what travels as a catalog reference and what as bytes, so
 * a 190 MB file is a choice and not a surprise. */
import { state } from '../../core/store.ts';
import { esc, fmtMB, plural } from '../../ui/format.ts';
import type { ShareEntry } from '../../api/content.ts';

export interface SharePlan { name: string; entries: ShareEntry[] }
export interface ShareLink { web?: string; count: number; skipped: unknown[] }
export interface ShareOptions { skip: string[]; author: string; note: string }

// Pre-flight for sharing: shows what travels as a catalog reference (free) and what has to
// go in as bytes, so a 190 MB file is a choice and not a surprise. Returns the export
// options, or null if cancelled.
export function shareDialog(plan: SharePlan): Promise<ShareOptions | null> {
  const heavy: ShareEntry[] = [];
  for (const e of plan.entries) {
    if (e.kind === 'embedded') heavy.push(e);
    for (const m of e.members || []) if (m.kind === 'embedded') heavy.push(m);
  }
  const count = (kind: string) => plan.entries.reduce((n, e) => n
    + (e.kind === kind ? 1 : 0)
    + (e.members || []).filter((m) => m.kind === kind).length, 0);
  const refs = count('catalog');
  const gone = count('missing');

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box share-box">
        <div class="share-title">${L`Поделиться пресетом «${plan.name}»`}</div>
        <div class="share-line">
          <span class="ms">link</span>
          <div><b>${refs}</b> ${plural(refs, 'мод из каталога', 'мода из каталога', 'модов из каталога')}
          <span class="share-hint">${L`уедут ссылками, почти не весят`}</span></div>
        </div>
        ${heavy.length ? `
          <div class="share-line">
            <span class="ms">inventory_2</span>
            <div><b>${heavy.length}</b> ${plural(heavy.length, 'свой мод', 'своих мода', 'своих модов')}
            <span class="share-hint">${L`нет в каталоге, поедут файлом целиком`}</span></div>
          </div>
          <div class="share-list">
            ${heavy.map((e) => `
              <label class="share-item">
                <input type="checkbox" class="lib-check" data-skip="${esc(e.key)}" checked>
                <span class="share-item-name">${esc(e.name)}</span>
                <span class="share-item-size">${fmtMB(e.size)} ${L`МБ`}</span>
              </label>`).join('')}
          </div>` : ''}
        ${gone ? `<div class="share-line muted"><span class="ms">block</span><div>${gone} ${plural(gone, 'мод не получится передать', 'мода не получится передать', 'модов не получится передать')}</div></div>` : ''}
        <input class="input" id="shareAuthor" placeholder="${L`Твой ник (необязательно)`}" maxlength="80" value="${esc(state.settings?.account?.username || '')}">
        <input class="input" id="shareNote" placeholder="${L`Пара слов о сборке (необязательно)`}" maxlength="200">
        <div class="share-total">${L`Размер файла:`} <b id="shareSize"></b></div>
        <div class="confirm-actions">
          <button class="btn" data-c="no">${L`Отмена`}</button>
          <button class="btn btn-primary" data-c="yes"><span class="ms">save</span>${L`Сохранить файл`}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const boxes = [...overlay.querySelectorAll<HTMLInputElement>('[data-skip]')];
    const paintSize = () => {
      const bytes = heavy.reduce((s, e, i) => s + (boxes[i]?.checked ? e.size : 0), 0);
      (overlay.querySelector('#shareSize') as HTMLElement).textContent = bytes > 512 * 1024
        ? `~${fmtMB(bytes)} ${L`МБ`}`
        : L`несколько КБ`;
    };
    boxes.forEach((b) => b.addEventListener('change', paintSize));
    paintSize();

    const field = (sel: string) => (overlay.querySelector(sel) as HTMLInputElement).value.trim();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(null); };
    const done = (v: ShareOptions | null) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    overlay.querySelector('[data-c="no"]')?.addEventListener('click', () => done(null));
    overlay.querySelector('[data-c="yes"]')?.addEventListener('click', () => done({
      skip: boxes.filter((b) => !b.checked).map((b) => b.dataset.skip || ''),
      author: field('#shareAuthor'),
      note: field('#shareNote'),
    }));
    document.addEventListener('keydown', onKey);
  });
}

/* One door to sharing, with both ways behind it and the difference between them stated
 * rather than implied. A link is a few hundred characters and installs from the catalog on
 * the other end; it cannot carry a mod the catalog does not have. The file carries anything,
 * and can run to hundreds of megabytes. Two equal buttons on the card made that a guess -
 * here the link is offered first, already made, and the file is one line below it.
 */
export function shareSheet(preset: { name: string }, link: ShareLink | null): Promise<'file' | null> {
  const skipped = link?.skipped || [];
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box share-box">
        <div class="share-title">${L`Поделиться пресетом «${preset.name}»`}</div>

        <div class="share-way">
          <div class="share-way-head"><span class="ms">link</span>${L`Ссылка`}</div>
          ${link?.web ? `
            <div class="share-copy">
              <input class="input mono" id="shareUrl" readonly value="${esc(link.web)}">
              <button class="btn btn-primary" id="shareCopyBtn"><span class="ms">content_copy</span>${L`Скопировать`}</button>
            </div>
            <div class="share-hint">${skipped.length
              ? L`Донесёт ${link.count} из каталога. Свои моды (${skipped.length}) в неё не влезут — для них файл.`
              : L`Открывается в менеджере и ставит моды из каталога.`}</div>` : `
            <div class="share-hint">${L`В пресете только свои моды — ссылка их не донесёт.`}</div>`}
        </div>

        <div class="share-way">
          <div class="share-way-head"><span class="ms">description</span>${L`Файл`}</div>
          <button class="btn" id="shareFileBtn"><span class="ms">save</span>${L`Сохранить файлом…`}</button>
          <div class="share-hint">${L`Донесёт и те моды, которых нет в каталоге. Дальше выберешь, что положить внутрь.`}</div>
        </div>

        <div class="confirm-actions">
          <button class="btn" data-c="no">${L`Закрыть`}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(null); };
    const done = (v: 'file' | null) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    overlay.querySelector('[data-c="no"]')?.addEventListener('click', () => done(null));
    overlay.querySelector('#shareFileBtn')?.addEventListener('click', () => done('file'));
    overlay.querySelector('#shareCopyBtn')?.addEventListener('click', (e) => {
      navigator.clipboard.writeText(link?.web || '');
      (overlay.querySelector('#shareUrl') as HTMLInputElement).select();
      flashCopied(e.currentTarget as CopyButton);
    });
    document.addEventListener('keydown', onKey);
  });
}

// Copy feedback in place of a dialog: the button goes green and says so for a few
// seconds. The original markup is stashed on the element so a double click can't lose it.
type CopyButton = HTMLElement & { _copiedTimer?: number; _copiedOriginal?: string };

function flashCopied(btn: CopyButton): void {
  clearTimeout(btn._copiedTimer);
  if (!btn._copiedOriginal) btn._copiedOriginal = btn.innerHTML;
  btn.classList.add('copied');
  btn.innerHTML = `<span class="ms">check</span>${L`Скопировано`}`;
  btn._copiedTimer = window.setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = btn._copiedOriginal || '';
  }, 5000);
}

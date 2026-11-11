/* The "Check" window of My mods (library/install-check.ts says what it checks and why). */
import { esc } from '../../ui/format.ts';
import { toast } from '../../ui/toast.ts';
import { state } from '../../core/store.ts';
import { checkAdvice, installChecks, type CheckLine } from '../../library/install-check.ts';
import type { BannersModel } from '../../library/model.ts';
import { lib } from './state.ts';

// whether Dota is open, as src/game-watch.ts reports it
let dotaRunning = false;
window.api.game.onRunning((running) => { dotaRunning = running; });

const ICON: Record<CheckLine['level'], string> = { ok: 'check_circle', warn: 'info', bad: 'error' };

export function checkHtml(lines: CheckLine[]): string {
  const rows = lines.map((l) => `<li class="check-line ${l.level}"><span class="ms">${ICON[l.level]}</span><span>${esc(l.text)}</span></li>`).join('');
  return `
    <div class="confirm-box cover-box" role="dialog" aria-modal="true" aria-labelledby="checkTitle">
      <div class="tool-head">
        <span class="ms">fact_check</span>
        <div>
          <div class="tool-title" id="checkTitle">${esc(L`Проверка установки`)}</div>
          <div class="tool-sub">${esc(L`Что приложение проверило, чтобы моды попали в игру.`)}</div>
        </div>
      </div>
      <ul class="check-list">${rows}</ul>
      <div class="tool-sub check-advice">${esc(checkAdvice(lines))}</div>
      <div class="confirm-actions">
        <button class="btn" data-c="report"><span class="ms">bug_report</span>${esc(L`Отчёт для поддержки`)}</button>
        <button class="btn btn-primary" data-c="close">${esc(L`Понятно`)}</button>
      </div>
    </div>`;
}

export function showInstallCheck(banners: BannersModel): void {
  const s = state.settings;
  const lines = installChecks(banners, {
    gameFound: Boolean(s?.dotaPathValid),
    folder: s?.gameLang?.folder || '',
    dotaRunning,
    enabled: state.masterOff ? 0 : lib.records.filter((r) => r.enabled).length,
    total: lib.records.length,
    slots: lib.slots,
    slotCeil: lib.slotCeil,
  });
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = checkHtml(lines);
  document.body.appendChild(overlay);
  const done = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(); };
  overlay.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === overlay) { done(); return; }
    const c = el.closest<HTMLElement>('[data-c]')?.dataset.c;
    if (c === 'close') done();
    if (c === 'report') {
      void window.api.diag.export().then((r) => {
        if (r?.error) toast(r.error, 'warn');
        else if (!r?.cancelled) toast(L`Отчёт сохранён и открыт в папке. Перетащи файл в канал поддержки в Discord`, 'ok', 9000);
      });
    }
  });
  document.addEventListener('keydown', onKey);
  overlay.querySelector<HTMLElement>('[data-c="close"]')?.focus();
}

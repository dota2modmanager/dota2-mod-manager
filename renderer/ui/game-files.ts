/* The item table, asked for where it is needed (3.0).
 *
 * Until 3.0 this was "safe mode", a switch in the status bar that was on by default. Behind it sat
 * the whole of Items (the builder, the game's own looks), the effects mods carry and the looks a
 * preset keeps: most of what the app had grown into, invisible until somebody went looking for a
 * switch with a frightening name. Hardly anybody did.
 *
 * Now everything is on show and nothing changes in the game's files until a person asks for
 * something that needs it: the first look picked, the first set put on, a preset with looks, a mod
 * whose effects live in the table. That is when the question comes, once, with what is edited and
 * how it is undone. The answer is kept (settings.schemaPatch, as before) and Settings, "Game files",
 * takes it back.
 *
 * VPK mods never come through here: they go into a folder the game reads anyway.
 */
import { state } from '../core/store.ts';
import { invalidateViews } from '../core/router.ts';
import { refreshCosmeticSlots } from '../core/installed.ts';
import { refreshPatchState } from './statusbar.ts';
import { toast } from './toast.ts';

/** True when the game will read the item table: allowed already, or allowed just now. */
export async function allowItemTable(): Promise<boolean> {
  if (state.settings?.schemaPatch) return true;
  if (!state.settings?.dotaPathValid) { toast(L`Сначала укажи путь к Dota 2 в настройках`, 'warn'); return false; }
  if (!await itemTableDialog()) return false;
  return setItemTable(true);
}

/** Allow the edit or take it back (Settings, "Game files"). Resolves whether it is now as asked. */
export async function setItemTable(on: boolean): Promise<boolean> {
  const r = await window.api.patch.setEnabled(on);
  if (r.error) { toast(r.error, 'error'); return false; }
  if (state.settings) state.settings = { ...state.settings, schemaPatch: on };
  await Promise.all([refreshCosmeticSlots(), refreshPatchState()]);
  invalidateViews();
  toast(on ? L`Готово: виды из игры и эффекты модов работают` : L`Файлы игры вернулись к оригиналу. Виды из игры и эффекты модов выключены, VPK-моды работают как работали.`);
  return true;
}

/* One window, said in full: what for, which two files, how it comes back, and the part nobody can
 * promise. Staying as things are is what a stray Enter answers. */
function itemTableDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box safe-box" role="dialog" aria-modal="true" aria-labelledby="tableDlgTitle">
        <div class="safe-title" id="tableDlgTitle">${L`Включить виды из игры и эффекты`}</div>
        <p class="safe-lede">${L`Виды предметов, конструктор героев и эффекты модов работают через таблицу предметов игры. Чтобы Dota её прочитала, приложение впишет свою папку в два файла игры:`}</p>
        <dl class="safe-files">
          <dt><code>gameinfo_branchspecific.gi</code></dt>
          <dd>${L`+ строка с папкой модов`}</dd>
          <dt><code>dota.signatures</code></dt>
          <dd>${L`+ подпись изменённого файла`}</dd>
        </dl>
        <p class="safe-undo">${L`Спрашиваем один раз. Оригиналы сохраняются: в настройках, раздел «Файлы игры», они возвращаются байт в байт. После обновления Dota приложение впишет правку заново само.`}</p>
        <div class="safe-risk">
          <span class="ms">warning</span>
          <div>${L`Правку файлов игры в моддинге Dota считают небезопасной. За 8+ лет мы не знаем ни одного бана за это. Гарантий всё равно не даём.`}</div>
        </div>
        <div class="confirm-actions">
          <button class="btn" data-c="no">${L`Не сейчас`}</button>
          <button class="btn btn-primary" data-c="yes">${L`Включить`}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const button = (c: string) => overlay.querySelector(`[data-c="${c}"]`) as HTMLButtonElement;
    const done = (v: boolean) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
    button('no').addEventListener('click', () => done(false));
    button('yes').addEventListener('click', () => done(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    button('no').focus();
  });
}

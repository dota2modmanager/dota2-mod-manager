/* The title bar: the window's own buttons, the section tabs, help and the hotkeys, the mods folder,
 * and the Discord account chip. */
import { state } from '../core/store.ts';
import { switchView } from '../core/router.ts';
import { esc } from '../ui/format.ts';
import { toast } from '../ui/toast.ts';
import { confirmDialog } from '../ui/dialog.ts';
import { bindHelp } from '../ui/help.ts';
import { bindHotkeys } from '../ui/hotkeys.ts';
import { loadCatalog } from '../views/catalog.ts';
import { byId } from './dom.ts';
import type { AppSettings } from '../api/app.ts';

const RESTORE = '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2" y="3.5" width="6.5" height="6.5" fill="none" stroke="currentColor" stroke-width="1.1" rx="1"/><path d="M4 3.5V2.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
const MAXIMIZE = '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2" rx="1"/></svg>';

/** The maximize button draws what it will do: restore a maximized window, maximize one that is not. */
export const paintMaximized = (maxed: boolean): void => { byId('winMax').innerHTML = maxed ? RESTORE : MAXIMIZE; };

byId('winMin').addEventListener('click', () => window.api.win.minimize());
byId('winMax').addEventListener('click', () => window.api.win.maximize());
byId('winClose').addEventListener('click', () => window.api.win.close());
window.api.win.onMaximized(paintMaximized);

document.querySelectorAll<HTMLElement>('.tb-tab').forEach((btn) => {
  btn.addEventListener('click', () => { if (btn.dataset.view) switchView(btn.dataset.view); });
});

bindHelp();
bindHotkeys({
  onSection: (view: string) => { if (state.view !== view) switchView(view); },
  onRefresh: () => { toast(L`Обновляю каталог…`); loadCatalog(true); },
});

byId('openModsFolderBtn').addEventListener('click', async () => {
  const r = await window.api.misc.openLangFolder();
  if (r.error) toast(r.error, 'error');
});

/* The Discord account. Empty (and invisible) when the build has no client id, so a user never
 * meets a sign-in button that cannot work. */
export function paintAccount(): void {
  const host = document.getElementById('tbAccount');
  if (!host) return;
  const s: Partial<AppSettings> = state.settings || {};
  if (!s.discordConfigured) { host.innerHTML = ''; return; }
  const acc = s.account;
  host.innerHTML = acc
    ? `<button class="tb-user" id="tbUserBtn" title="${esc(L`Выйти из аккаунта`)}">
         ${acc.avatar ? `<img src="${esc(acc.avatar)}" alt="">` : '<span class="ms">person</span>'}
         <span class="tb-user-name">${esc(acc.username)}</span>
       </button>`
    : `<button class="tb-login" id="tbLoginBtn" title="${esc(L`Вход нужен, чтобы подписывать свои сборки`)}">
         <span class="ms">login</span>${L`Войти`}
       </button>`;

  document.getElementById('tbLoginBtn')?.addEventListener('click', async (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    toast(L`Открыл Discord в браузере — подтверди вход там`, 'ok', 6000);
    const r = await window.api.account.signIn();
    if (r.error) toast(r.error, 'error', 7000);
    else toast(L`Привет, ${r.account.username}`);
    state.settings = await window.api.settings.get();
    paintAccount();
  });
  document.getElementById('tbUserBtn')?.addEventListener('click', async () => {
    if (!await confirmDialog(L`Выйти из аккаунта «${acc?.username}»?`, { okLabel: L`Выйти`, danger: false })) return;
    await window.api.account.signOut();
    state.settings = await window.api.settings.get();
    paintAccount();
  });
}
// drawn in whichever language was on when it was drawn (see applyLanguage in ui/language.ts)
document.addEventListener('mm:language', () => paintAccount());

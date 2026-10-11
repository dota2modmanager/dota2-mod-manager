/* Dota 2 Mod Manager: the window itself.
 *
 * Everything that is not a screen lives in shell/, one module per piece, each wiring itself as it
 * loads: the title bar (titlebar.ts), the status bar's switches (switches.ts), the search
 * (search.ts), files dropped on the window (drop.ts), the progress bar (progress.ts) and news of an
 * update or a Dota patch (updates.ts). The screens register themselves with the router the same
 * way. What is left here is the order: the translations first, then the pieces, then boot().
 */
// first, before any module that calls L or tr: i18n.js puts them on window
import './locales/zh-CN-catalog.js';
import './locales/zh-CN-library.js';
import './locales/zh-CN-app.js';
import './i18n.js';
import './shell/errors.ts';
import { paintAccount, paintMaximized } from './shell/titlebar.ts';
import './shell/switches.ts';
import './shell/search.ts';
import './shell/drop.ts';
import './shell/progress.ts';
import './shell/updates.ts';
import './views/settings.ts';
import { state } from './core/store.ts';
import { render, invalidateViews } from './core/router.ts';
import { refreshInstalledIndex, refreshCosmeticSlots } from './core/installed.ts';
import { switchOffStaleTerrains } from './core/terrain-age.ts';
import { askAdultOnce } from './core/adult.ts';
import { toast } from './ui/toast.ts';
import { showWhatsNew, toolchainDialog } from './ui/dialog.ts';
import { watchMedia } from './ui/media.ts';
import { refreshPatchState, refreshMasterSwitch, refreshSidebarStatus } from './ui/statusbar.ts';
import { applyContentZoom, readPanels, bindPanels } from './ui/chrome.ts';
import { applyStaticI18n, showLanguagePicker } from './ui/language.ts';
import { initTheme } from './ui/theme.ts';
import { initQueue } from './ui/queue.ts';
import { initA11y } from './ui/a11y.ts';
import { loadCatalog } from './views/catalog.ts';

/* Fetching it is a download of somebody else's program, so it happens on a yes and never
 * otherwise. Either answer is remembered: the question is asked once and Settings carries it from
 * there, and a failed download does not re-ask on the next launch either - the row in Settings
 * says what happened and offers the retry. */
async function offerToolchain(): Promise<void> {
  let wanted = false;
  try { wanted = await toolchainDialog(); } catch { /* nothing shown, nothing fetched */ }
  await window.api.settings.set('toolsPromptSeen', true);
  if (!wanted) return;
  const r = await window.api.tools.install('vrf');
  if (r?.error) toast(L`Не удалось скачать: ${r.error}. Попробовать снова можно в настройках.`, 'error', 8000);
  else toast(L`Source 2 Viewer установлен — превью модов заработают`);
}

(async function boot() {
  // focus into and out of every window over the app, dialogs named, icons silent (ui/a11y.ts)
  initA11y();
  /* Pictures come from the network and the network is the part that fails. Started before
     anything is drawn so the first grid is covered too: a preview that cannot be fetched is asked
     for again from the mirror, and if that fails the tile says so instead of leaving a grey
     rectangle with no explanation anywhere on the screen. */
  watchMedia(() => toast(L`Часть превью не загрузилась. Проверь интернет — каталог и моды работают`, 'warn', 7000));

  if (await window.api.win.isMaximized()) paintMaximized(true);

  // language: settings.json is the source of truth; reconcile the localStorage-seeded value
  const cfg = await window.api.settings.get();
  state.settings = cfg;
  state.favorites = new Set(Array.isArray(cfg.favorites) ? cfg.favorites : []);
  state.panels = readPanels(cfg.panels);
  applyContentZoom(Number(cfg.uiScale) || 1);
  window.I18N_LANG = cfg.uiLang === 'ru' || cfg.uiLang === 'zh-CN' ? cfg.uiLang : 'en';
  try { localStorage.setItem('uiLang', window.I18N_LANG); } catch { /* ignore */ }
  applyStaticI18n();
  initTheme();
  initQueue();
  bindPanels();
  paintAccount();

  // the load order was laid out in its two parts on this start (installer.migrateSlotZones)
  if (cfg.slotMigration) {
    toast(L`Порядок загрузки обновлён: шейдеры, деревья, река, эффекты героев и ещё несколько категорий теперь грузятся раньше остальных модов.`, 'ok', 9000);
  }
  // startup put the mods where the game will look for them and pointed the game there: said once,
  // because the game has to be restarted before it reads the new folder
  if (cfg.langMigration) {
    toast(L`Моды перенесены в dota_${cfg.langMigration.to} — папку, которую монтирует твоя озвучка. Перезапусти игру.`, 'warn', 9000);
  }

  await refreshSidebarStatus();
  await refreshMasterSwitch();
  await refreshPatchState();
  await switchOffStaleTerrains();
  await refreshInstalledIndex();
  await refreshCosmeticSlots();
  await loadCatalog();

  // first launch, or first launch after this release: let the user pick a language
  if (!cfg.langPromptSeen) await showLanguagePicker();

  // mods the catalog tags adult stay hidden until the user says they are 18 and wants them: asked
  // once, in the language just chosen, and only when the catalog has any (core/adult.ts)
  if (await askAdultOnce()) {
    invalidateViews();
    render();
  }

  // the one thing the app cannot do for itself: the fifty megabytes that read Dota's compiled
  // formats. Asked once, on the same run as the language, because a mod with no picture is the
  // first thing somebody notices and the last thing they think to go fix in Settings
  if (!cfg.toolsPromptSeen) await offerToolchain();

  // the app updates itself in the background, so this is the only place a user finds out what
  // changed while they were away
  showWhatsNew();
})();

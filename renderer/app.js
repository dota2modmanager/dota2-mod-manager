/* Dota 2 Mod Manager — the window itself.
 *
 * What is left here is everything that is not a screen: the titlebar buttons, the tabs, the
 * status bar's launch and switches, the account chip, files dropped on the window, the
 * progress bar, the update banner, and the boot sequence that puts it all in order.
 *
 * The screens are imported for the side effect of registering themselves with the router;
 * this file names none of them. The three named imports below are the only things a screen
 * still owes the window, and each is there because the event starts outside the screen: a
 * dropped file lands wherever the user happens to be standing, and the catalog is fetched
 * before any screen exists.
 */
'use strict';
import { $ } from './core/dom.js';
import { COSMETIC_PREFIX } from './core/constants.js';
import { esc, fmtMB } from './ui/format.js';
import { showWhatsNew, confirmDialog, safeModeDialog, toolchainDialog } from './ui/dialog.js';
import { state } from './core/store.js';
import { toast } from './ui/toast.js';
import { watchMedia } from './ui/media.js';
import { render, switchView, invalidateViews } from './core/router.js';
import { refreshInstalledIndex, refreshCosmeticSlots } from './core/installed.js';
import { switchOffStaleTerrains } from './core/terrain-age.js';
import { askAdultOnce } from './core/adult.js';
import { refreshPatchState, paintMasterSwitch, refreshMasterSwitch, refreshSidebarStatus } from './ui/statusbar.js';
import { applyContentZoom, readPanels, bindPanels } from './ui/chrome.js';
import { applyStaticI18n, showLanguagePicker } from './ui/language.js';
import { initTheme } from './ui/theme.js';
import { initQueue } from './ui/queue.js';
import { bindHelp } from './ui/help.js';
import { bindHotkeys } from './ui/hotkeys.js';
import { handleImportResult } from './views/library.js';
import { loadCatalog } from './views/catalog.js';
import { handlePresetImport } from './views/presets.js';
import './views/settings.js';

// A crash the user can't explain is the hardest kind to fix from a support chat. Both land
// in the app's own log (see main.js diag:rendererError / src/diagnostics.js), so "it broke"
// turns into a report the user can export instead of a guessing game over Discord.
window.addEventListener('error', (e) => {
  window.api.diag.reportError(`window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener('unhandledrejection', (e) => {
  window.api.diag.reportError(`unhandledrejection: ${e.reason?.stack || e.reason}`);
});

// ---------- window controls ----------

$('#winMin').addEventListener('click', () => window.api.win.minimize());
$('#winMax').addEventListener('click', () => window.api.win.maximize());
$('#winClose').addEventListener('click', () => window.api.win.close());
window.api.win.onMaximized((maxed) => {
  $('#winMax').innerHTML = maxed
    ? '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2" y="3.5" width="6.5" height="6.5" fill="none" stroke="currentColor" stroke-width="1.1" rx="1"/><path d="M4 3.5V2.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>'
    : '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2" rx="1"/></svg>';
});

// ---------- navigation ----------

document.querySelectorAll('.tb-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

bindHelp();
bindHotkeys({
  onSection: (view) => { if (state.view !== view) switchView(view); },
  onRefresh: () => { toast(L`Обновляю каталог…`); loadCatalog(true); },
});

$('#openModsFolderBtn').addEventListener('click', async () => {
  const r = await window.api.misc.openLangFolder();
  if (r.error) toast(r.error, 'error');
});

// ---------- launch + master mods switch (status bar) ----------

$('#launchBtn')?.addEventListener('click', async () => {
  if (!state.settings?.dotaPathValid) { toast(L`Сначала укажи путь к Dota 2 в настройках`, 'warn'); return; }
  await window.api.game.launch();
  toast(state.masterOff ? L`Запуск Dota 2 без модов…` : L`Запуск Dota 2 с модами…`);
});

// Discord account in the title bar. Empty (and invisible) when the build has no client id,
// so a user never meets a sign-in button that cannot work.
function paintAccount() {
  const host = $('#tbAccount');
  if (!host) return;
  const s = state.settings || {};
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

  $('#tbLoginBtn')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    toast(L`Открыл Discord в браузере — подтверди вход там`, 'ok', 6000);
    const r = await window.api.account.signIn();
    if (r.error) toast(r.error, 'error', 7000);
    else toast(L`Привет, ${r.account.username}`);
    state.settings = await window.api.settings.get();
    paintAccount();
  });
  $('#tbUserBtn')?.addEventListener('click', async () => {
    if (!await confirmDialog(L`Выйти из аккаунта «${acc.username}»?`, { okLabel: L`Выйти`, danger: false })) return;
    await window.api.account.signOut();
    state.settings = await window.api.settings.get();
    paintAccount();
  });
}
// drawn in whichever language was on when it was drawn (see applyLanguage in ui/language.js)
document.addEventListener('mm:language', () => paintAccount());


$('#modsMasterBtn')?.addEventListener('click', async () => {
  const btn = $('#modsMasterBtn');
  btn.disabled = true;
  const enable = state.masterOff; // currently off -> turn on, and vice-versa
  const r = await window.api.mods.setMaster(enable);
  btn.disabled = false;
  if (r.error) { toast(r.error, 'error'); return; }
  state.masterOff = !enable;
  paintMasterSwitch();
  toast(enable ? L`Моды включены` : L`Моды выключены — игра запустится ванильной`);
  // the Library draws every row from this, and it keeps what it built while you are elsewhere
  invalidateViews();
  if (state.view === 'library') render();
});


$('#safeModeBtn')?.addEventListener('click', async () => {
  const btn = $('#safeModeBtn');
  const turningUnsafe = !state.settings?.schemaPatch === true; // currently safe -> about to turn it off
  if (turningUnsafe) {
    if (!await safeModeDialog()) return;
  }
  btn.disabled = true;
  const r = await window.api.patch.setEnabled(turningUnsafe);
  btn.disabled = false;
  if (r.error) { toast(r.error, 'error'); return; }
  state.settings = { ...state.settings, schemaPatch: turningUnsafe };
  toast(turningUnsafe ? L`Безопасный режим выключен — эффекты и косметика доступны` : L`Безопасный режим включён, файлы игры восстановлены. Эффекты и косметика ждут, пока не выключишь его снова.`);
  await Promise.all([refreshCosmeticSlots(), refreshPatchState()]);
  if (state.view === 'catalog') {
    // the cosmetics rail section just appeared or disappeared — bail out of a category
    // that no longer exists rather than show a dead one
    if (!turningUnsafe && state.activeCategory.startsWith(COSMETIC_PREFIX)) state.activeCategory = 'all';
    render();
  }
});

/* Fetching it is a download of somebody else's program, so it happens on a yes and never
 * otherwise. Either answer is remembered: the question is asked once and Settings carries it
 * from there, and a failed download does not re-ask on the next launch either - the row in
 * Settings says what happened and offers the retry. */
async function offerToolchain() {
  let wanted = false;
  try { wanted = await toolchainDialog(); } catch { /* nothing shown, nothing fetched */ }
  await window.api.settings.set('toolsPromptSeen', true);
  if (!wanted) return;
  const r = await window.api.tools.install('vrf');
  if (r?.error) toast(L`Не удалось скачать: ${r.error}. Попробовать снова можно в настройках.`, 'error', 8000);
  else toast(L`Source 2 Viewer установлен — превью модов заработают`);
}

// global search
let searchTimer = null;
$('#globalSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value;
    $('#clearSearch').classList.toggle('hidden', !state.search);
    // The catalog draws the results, and a catalog opened from another section is shown as it
    // was left unless it is marked out of date: a search typed on Settings opened the home
    // screen with no results on it (found by the simulation, tools/sim, 2026-09-24).
    if (state.view !== 'catalog') { invalidateViews(); switchView('catalog'); }
    else render();
  }, 180);
});
$('#clearSearch').addEventListener('click', () => {
  $('#globalSearch').value = '';
  state.search = '';
  $('#clearSearch').classList.add('hidden');
  if (state.view === 'catalog') render();
  else invalidateViews(); // so the catalog does not come back still showing the old results
});

// drag & drop of .vpk files anywhere in the window -> import
let dragDepth = 0;
// setting dropEffect=copy on every dragover is what actually lets Windows deliver the
// drop; without it some setups report effect "none" and the drop event never fires
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) {
    dragDepth++;
    document.body.classList.add('dropping');
  }
});
document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dropping');
  }
});
// A dropped folder has no extension and no type — the main process walks it for .vpk
// files, which is how a whole unzipped Skinchanger pack can be dropped in at once.
const isFolderFile = (f) => !f.type && !/\.[a-z0-9]+$/i.test(f.name || '');

// Mod files, an archive of them, or a folder to scan.
async function dropMods(dropped) {
  const wanted = dropped.filter((f) => /\.(vpk|zip)$/i.test(f.name || '') || isFolderFile(f));
  if (!wanted.length) {
    toast(L`Импортировать можно .vpk файлы, .zip или папку с ними`, 'warn', 5000);
    return;
  }
  if (state.view !== 'library') switchView('library');
  // prefer real on-disk paths (lets the importer pick up sibling _NNN parts too)
  const paths = wanted.map((f) => { try { return window.api.mods.pathForFile(f); } catch { return null; } }).filter(Boolean);
  if (paths.length === wanted.length) {
    handleImportResult(await window.api.mods.importPaths(paths));
    return;
  }
  // fallback: some setups don't expose a path for dropped files — send the raw bytes
  const files = wanted.filter((f) => !isFolderFile(f));
  if (!files.length) { toast(L`Не удалось прочитать перетащенную папку`, 'error'); return; }
  try {
    const items = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    handleImportResult(await window.api.mods.importBuffers(items));
  } catch {
    toast(L`Не удалось прочитать перетащенные файлы`, 'error');
  }
}

// A received .d2mm.
async function dropPresets(dropped) {
  const file = dropped.find((f) => /\.d2mm$/i.test(f.name || ''));
  let p = null;
  try { p = window.api.mods.pathForFile(file); } catch { /* no path for this drop */ }
  if (!p) { toast(L`Не удалось прочитать файл пресета`, 'error'); return; }
  handlePresetImport(await window.api.presets.importFile(p)); // switches to Presets itself
}

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dropping');
  const dropped = [...(e.dataTransfer?.files || [])];
  if (!dropped.length) return;
  // The file says what to do with it, not the tab that happens to be open. Routing by tab
  // meant a preset dropped anywhere but Presets was answered with "open the other tab" —
  // a file arriving from Discord lands wherever the user happens to be standing.
  if (dropped.some((f) => /\.d2mm$/i.test(f.name || ''))) return dropPresets(dropped);
  if (dropped.some((f) => /\.(vpk|zip)$/i.test(f.name || '') || isFolderFile(f))) return dropMods(dropped);
  toast(L`Сюда можно бросить моды (.vpk, .zip, папку) или пресет .d2mm`, 'warn', 5000);
});

// a d2mm:// link clicked outside the app (or the one it was launched with)
window.api.presets.onLink((res) => handlePresetImport(res));

// ---------- progress ----------

let progressHideTimer = null;
window.api.onProgress((evt) => {
  const bar = $('#progressBar');
  if (evt.type === 'download') {
    bar.classList.remove('hidden');
    $('#progressLabel').textContent = L`Скачивание: ${evt.label}`;
    if (evt.total > 0) {
      $('#progressSize').textContent = `${fmtMB(evt.loaded)} / ${fmtMB(evt.total)} MB`;
      $('#progressFill').style.width = `${(evt.loaded / evt.total) * 100}%`;
    } else {
      $('#progressSize').textContent = `${fmtMB(evt.loaded)} MB`;
      $('#progressFill').style.width = '40%';
    }
    clearTimeout(progressHideTimer);
  } else if (evt.type === 'count') {
    // a batch the app is working through: how many of how many, not a guessed percentage
    bar.classList.remove('hidden');
    $('#progressLabel').textContent = evt.label;
    $('#progressSize').textContent = `${evt.done} / ${evt.total}`;
    $('#progressFill').style.width = `${evt.total ? (evt.done / evt.total) * 100 : 0}%`;
    clearTimeout(progressHideTimer);
  } else if (evt.type === 'stage') {
    $('#progressLabel').textContent = `${evt.label}: ${evt.stage}`;
    $('#progressFill').style.width = '95%';
  } else if (evt.type === 'done' || evt.type === 'error') {
    $('#progressFill').style.width = '100%';
    clearTimeout(progressHideTimer);
    progressHideTimer = setTimeout(() => bar.classList.add('hidden'), 800);
  }
});

// ---------- auto-update ----------

window.api.update.onUpdate((evt) => {
  if (evt.type === 'available') {
    toast(L`Найдено обновление v${evt.version} — скачиваю в фоне…`, 'ok', 6000);
  } else if (evt.type === 'portable') {
    // A portable copy cannot install over itself, so the new build is fetched to sit beside it
    // and this turns into "it is there, go run it". Nothing on disk is replaced.
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.innerHTML = `
      <span class="ms">system_update_alt</span>
      <span>${L`Вышла версия `}<b>v${esc(evt.version)}</b></span>
      <button class="btn btn-sm btn-primary" id="portableGetBtn">${L`Скачать рядом`}</button>
      <button class="btn btn-sm btn-ghost" id="portableLaterBtn">${L`Позже`}</button>`;
    document.body.appendChild(bar);
    bar.querySelector('#portableLaterBtn').addEventListener('click', () => bar.remove());
    bar.querySelector('#portableGetBtn').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      const r = await window.api.update.fetchPortable();
      if (r?.error) { toast(r.error, 'error', 7000); btn.disabled = false; return; }
      bar.innerHTML = `
        <span class="ms">check_circle</span>
        <span>${L`Новая версия лежит рядом: `}<b>${esc(r.name)}</b>${L`. Закрой это окно и запусти её.`}</span>
        <button class="btn btn-sm btn-primary" id="portableShowBtn">${L`Показать файл`}</button>
        <button class="btn btn-sm btn-ghost" id="portableCloseBtn">${L`Понятно`}</button>`;
      bar.querySelector('#portableShowBtn').addEventListener('click', () => window.api.update.revealPortable(r.path));
      bar.querySelector('#portableCloseBtn').addEventListener('click', () => bar.remove());
    });
  } else if (evt.type === 'downloaded') {
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.innerHTML = `
      <span class="ms">system_update_alt</span>
      <span>${L`Обновление `}<b>v${esc(evt.version)}</b>${L` готово к установке`}</span>
      <button class="btn btn-sm btn-primary" id="updateNowBtn">${L`Перезапустить и обновить`}</button>
      <button class="btn btn-sm btn-ghost" id="updateLaterBtn">${L`Позже`}</button>`;
    document.body.appendChild(bar);
    bar.querySelector('#updateNowBtn').addEventListener('click', () => window.api.update.install());
    bar.querySelector('#updateLaterBtn').addEventListener('click', () => bar.remove());
  }
});

// ---------- Dota patched while the app was open ----------

// The repair itself runs in the main process whether or not this window is looking; this
// only decides how the user hears about it. On My mods that is the banner, so redraw and
// let it speak; anywhere else a toast, because a patch that ate the mods is news wherever
// you happen to be standing.
window.api.patch.onRepair((st) => {
  // an update can change the map under a whole-map terrain (renderer/core/terrain-age.js)
  if (st.state === 'done') switchOffStaleTerrains().then((off) => { if (off.length && state.view === 'library') render(); });
  if (state.view === 'library') { render(); return; }
  if (st.state === 'waiting') toast(L`Dota обновилась — вернём моды, как только закроешь игру`, 'warn', 8000);
  else if (st.state === 'failed') toast(L`Dota обновилась, вернуть моды не вышло — загляни в «Мои моды»`, 'error', 8000);
  else if (st.state === 'done') toast(L`Dota обновилась — моды на месте`, 'ok', 6000);
});

// ---------- boot ----------

(async function boot() {
  /* Pictures come from the network and the network is the part that fails. Started before
     anything is drawn so the first grid is covered too: a preview that cannot be fetched is
     asked for again from the mirror, and if that fails the tile says so instead of leaving a
     grey rectangle with no explanation anywhere on the screen. */
  watchMedia(() => toast(L`Часть превью не загрузилась. Проверь интернет — каталог и моды работают`, 'warn', 7000));

  const maxed = await window.api.win.isMaximized();
  if (maxed) $('#winMax').innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2" y="3.5" width="6.5" height="6.5" fill="none" stroke="currentColor" stroke-width="1.1" rx="1"/><path d="M4 3.5V2.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

  // language: settings.json is the source of truth; reconcile the localStorage-seeded value
  const cfg = await window.api.settings.get();
  state.settings = cfg;
  state.favorites = new Set(Array.isArray(cfg.favorites) ? cfg.favorites : []);
  state.panels = readPanels(cfg.panels);
  applyContentZoom(Number(cfg.uiScale) || 1);
  window.I18N_LANG = cfg.uiLang === 'ru' ? 'ru' : 'en';
  try { localStorage.setItem('uiLang', window.I18N_LANG); } catch { /* ignore */ }
  applyStaticI18n();
  initTheme();
  initQueue();
  bindPanels();
  paintAccount();

  // startup put the mods where the game will look for them, and pointed the game there —
  // say so once, because the game has to be restarted before it reads the new folder
  // the load order was laid out in its two parts on this start (installer.migrateSlotZones)
  if (cfg.slotMigration) {
    toast(L`Порядок загрузки обновлён: шейдеры, деревья, река, эффекты героев и ещё несколько категорий теперь грузятся раньше остальных модов.`, 'ok', 9000);
  }
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

  // first launch, or first launch after this release — let the user pick a language
  if (!cfg.langPromptSeen) await showLanguagePicker();

  // mods the catalog tags adult stay hidden until the user says they are 18 and wants them:
  // asked once, in the language just chosen, and only when the catalog has any (core/adult.js)
  if (await askAdultOnce()) {
    invalidateViews();
    render();
  }

  // …and the one thing the app cannot do for itself: the fifty megabytes that read Dota's
  // compiled formats. Asked once, on the same run as the language, because a mod with no
  // picture is the first thing somebody notices and the last thing they think to go fix in
  // Settings - which is where nobody ever pressed the button.
  if (!cfg.toolsPromptSeen) await offerToolchain();

  // the app updates itself in the background, so this is the only place a user finds out
  // what changed while they were away
  showWhatsNew();
})();

/* Settings: everything the app itself remembers. This reads it and hands the page to React
 * (settings/SettingsScreen.tsx); what is genuinely here is the wiring: which control writes which
 * value, and what has to be repainted once it does.
 *
 * What is deliberately not here: anything about Dota's own languages or the folder mods go into.
 * The folder follows the game's audio language and the app arranges that itself (keepModFolder in
 * src/game-upkeep.ts). Dota's text language is the user's, chosen when they installed the game, and no mod
 * depends on it. Where mods can go missing is news, not a setting, so it is a banner in My mods.
 *
 * The one import from another screen is loadCatalog, for the button that fetches the catalog
 * again. It asks the catalog for its data, not for a drawing, so the router is not what it wants. */
import { state } from '../core/store.ts';
import { registerView, invalidateViews } from '../core/router.ts';
import { fmtMB } from '../ui/format.ts';
import { toast } from '../ui/toast.ts';
import { showWhatsNew } from '../ui/dialog.ts';
import { refreshSidebarStatus } from '../ui/statusbar.ts';
import { clampScale, currentScalePct, paintScale, applyScalePct, clampPanelZoom, paintPanels, savePanels } from '../ui/chrome.ts';
import { applyLanguage } from '../ui/language.ts';
import { paint } from '../ui/transitions.ts';
import { adultShown, adultHint, setAdultShown } from '../core/adult.ts';
import { loadCatalog } from './catalog.ts';
import { showSettings, type SettingsActions, type SettingsModel } from '../settings/SettingsScreen.tsx';

let model: SettingsModel | null = null;
let key = 0;

registerView('settings', () => renderSettings(true));

async function renderSettings(fresh = false): Promise<void> {
  /* Asked all at once: one after another they were seven trips to the main process before the page
   * drew, and the compiler's state looks for Wine on disk. The longer the wait, the longer a click
   * lands on the page the redraw is about to replace (the Linux simulation's language switch, on
   * the pull request that added the compiler). */
  const [s, cacheSize, version, tools, compiler, beta] = await Promise.all([
    window.api.settings.get(),
    window.api.misc.cacheSize(),
    window.api.update.version(),
    window.api.tools.state().catch(() => null), // older build
    window.api.compiler.state().catch(() => null),
    window.api.beta.state().catch(() => ({ eligible: false, on: false })),
  ]);
  state.settings = s;
  const vrf = tools?.tools.find((x) => x.name === 'vrf') || null;
  if (fresh) key++;
  const fetchedAt = (state.catalog as { fetchedAt?: number } | null)?.fetchedAt;
  model = {
    key,
    uiLang: s.uiLang,
    scalePct: Math.round((Number(s.uiScale) || 1) * 100),
    presence: s.discordPresence !== false,
    countDownloads: s.countDownloads !== false,
    beta,
    dotaPath: s.dotaGamePath || '',
    dotaValid: Boolean(s.dotaPathValid),
    cache: `${fmtMB(cacheSize)} MB`,
    proxy: s.downloadProxy || '',
    // no row on a machine with no build of it: the button could only fail
    vrf: vrf && vrf.available !== false ? { ready: Boolean(vrf.ready), size: `${fmtMB(vrf.ready ? vrf.installedBytes : vrf.downloadBytes)} MB` } : null,
    compiler,
    catalogUpdated: fetchedAt ? new Date(fetchedAt).toLocaleString(window.i18nLocale()) : '—',
    adult: adultShown(),
    adultHint: adultHint(),
    version,
  };
  await paint(draw);
}

function draw(): void {
  if (model) showSettings(model, actions);
}

/** A switch that shows its new position at once and tells main after. */
function flip(field: 'presence' | 'adult' | 'countDownloads'): boolean {
  if (!model) return false;
  model = { ...model, [field]: !model[field] };
  draw();
  return model[field];
}

// One slider moves the panels with the content; each panel keeps its own grip and Ctrl + wheel for
// anyone who wants them apart.
function setEverything(pct: number) {
  const v = clampScale(pct);
  for (const k of ['topZoom', 'bottomZoom', 'railZoom'] as const) state.panels[k] = clampPanelZoom(v / 100);
  paintPanels();
  savePanels();
  applyScalePct(v);
}

const actions: SettingsActions = {
  // the app language, and only the app: what somebody reads Dota in was decided when they installed it
  language: async (lang) => {
    await applyLanguage(lang);
    toast(lang === 'ru' ? L`Язык переключён на Русский` : lang === 'zh-CN' ? L`Язык переключён на 简体中文` : L`Язык переключён на English`);
    renderSettings();
  },
  scale: (pct, live) => { if (live) paintScale(clampScale(pct)); else setEverything(pct); },
  scaleStep: (delta) => setEverything(delta === null ? 100 : currentScalePct() + delta),
  presence: async () => {
    state.settings = await window.api.settings.set('discordPresence', flip('presence'));
  },
  countDownloads: async () => {
    state.settings = await window.api.settings.set('countDownloads', flip('countDownloads'));
  },
  beta: async () => {
    if (!model) return;
    model = { ...model, beta: { ...model.beta, on: !model.beta.on } };
    draw();
    const now = await window.api.beta.set(model.beta.on);
    toast(now.on ? L`Бета-версии включены` : L`Бета-версии выключены`);
  },
  detect: async () => {
    const found = await window.api.settings.detectDota();
    if (found) toast(L`Dota 2 найдена: ${found}`);
    else toast(L`Не нашёл автоматически — укажи вручную`, 'warn');
    renderSettings();
    refreshSidebarStatus();
  },
  browse: async () => {
    const r = await window.api.settings.browseDota();
    if (r?.error) toast(r.error, 'error');
    if (r?.path) toast(L`Путь сохранён`);
    renderSettings();
    refreshSidebarStatus();
  },
  clearCache: async () => {
    await window.api.misc.clearCache();
    toast(L`Кэш очищен`);
    renderSettings();
  },
  proxySave: async (value) => {
    try {
      const next = await window.api.settings.set('downloadProxy', value.trim());
      state.settings = next;
      toast(value.trim() ? L`Прокси сохранён` : L`Прокси отключён`);
      renderSettings();
    } catch (err) {
      toast(err instanceof Error ? err.message : L`Не удалось сохранить прокси`, 'error');
    }
  },
  proxyTest: async (value) => {
    const result = await window.api.settings.testProxy(value.trim());
    if (result?.error) toast(result.error, 'error');
    else toast(value.trim() ? L`Прокси работает` : L`Прямое подключение включено`);
  },
  proxyClear: async () => actions.proxySave(''),
  tool: async (install) => {
    if (install) {
      toast(L`Скачиваю инструмент — это разово`, 'ok', 5000);
      const r = await window.api.tools.install('vrf');
      if (r?.error) toast(r.error, 'error', 7000);
      else toast(L`Готово — картинки теперь берутся из игры`);
    } else {
      await window.api.tools.remove('vrf');
      toast(L`Инструмент удалён — картинки снова из вики`);
    }
    await renderSettings();
  },
  compilerBrowse: async () => {
    const r = await window.api.compiler.browse();
    if (r?.error) toast(r.error, 'error', 7000);
    else if (r?.ok) toast(L`Компилятор выбран`);
    renderSettings();
  },
  compilerForget: async () => {
    await window.api.compiler.forget();
    renderSettings();
  },
  // a few seconds of wineboot the first time; the button stays pressed until it answers
  compilerPrepare: async () => {
    const r = await window.api.compiler.prepare();
    if (r?.error) toast(r.error, 'error', 7000);
    else toast(L`Wine готов`);
    await renderSettings();
  },
  compilerCheck: async () => {
    const r = await window.api.compiler.check();
    if (r?.error) toast(r.error, 'error', 7000);
    else toast(L`Компилятор работает`);
    await renderSettings();
  },
  compilerKeep: async () => {
    const r = await window.api.compiler.keep();
    if (r?.error) toast(r.error, 'error', 7000);
    else toast(L`Копия Workshop Tools сохранена`);
    await renderSettings();
  },
  compilerRemoveKept: async () => {
    await window.api.compiler.removeKept();
    toast(L`Копия Workshop Tools удалена`);
    renderSettings();
  },
  refreshCatalog: async () => {
    await loadCatalog(true);
    renderSettings();
  },
  // the catalog and the search draw again with or without them the next time they open
  adult: async () => {
    await setAdultShown(flip('adult'));
    invalidateViews();
  },
  exportReport: async () => {
    const r = await window.api.diag.export();
    if (r?.cancelled) return;
    if (r?.error) toast(r.error, 'error', 7000);
    else toast(L`Отчёт сохранён`);
  },
  whatsNew: () => showWhatsNew({ force: true }),
  open: (url) => window.api.misc.openExternal(url),
};

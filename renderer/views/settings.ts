/* Settings: everything the app itself remembers. This reads it and hands the page to React
 * (settings/SettingsScreen.tsx); what is genuinely here is the wiring: which control writes which
 * value, and what has to be repainted once it does.
 *
 * What is deliberately not here: anything about Dota's own languages or the folder mods go into.
 * The folder follows the game's audio language and the app arranges that itself (keepModFolder in
 * main.js). Dota's text language is the user's, chosen when they installed the game, and no mod
 * depends on it. Where mods can go missing is news, not a setting, so it is a banner in My mods.
 *
 * The one import from another screen is loadCatalog, for the button that fetches the catalog
 * again. It asks the catalog for its data, not for a drawing, so the router is not what it wants. */
import { state } from '../core/store.js';
import { registerView, invalidateViews } from '../core/router.js';
import { fmtMB } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { showWhatsNew } from '../ui/dialog.js';
import { refreshSidebarStatus } from '../ui/statusbar.js';
import { clampScale, currentScalePct, paintScale, applyScalePct, clampPanelZoom, paintPanels, savePanels } from '../ui/chrome.js';
import { applyLanguage } from '../ui/language.js';
import { paint } from '../ui/transitions.js';
import { adultShown, adultHint, setAdultShown } from '../core/adult.js';
import { loadCatalog } from './catalog.ts';
import { showSettings, type SettingsActions, type SettingsModel } from '../settings/SettingsScreen.tsx';

let model: SettingsModel | null = null;
let key = 0;

registerView('settings', () => renderSettings(true));

export async function renderSettings(fresh = false): Promise<void> {
  const s = await window.api.settings.get();
  state.settings = s;
  const cacheSize = await window.api.misc.cacheSize();
  const version = await window.api.update.version();
  let vrf = null;
  try { vrf = (await window.api.tools.state()).tools.find((x: { name: string }) => x.name === 'vrf') || null; } catch { /* older build */ }
  let beta = { eligible: false, on: false };
  try { beta = await window.api.beta.state(); } catch { /* older build */ }
  if (fresh) key++;
  const fetchedAt = (state.catalog as { fetchedAt?: number } | null)?.fetchedAt;
  model = {
    key,
    uiLang: s.uiLang,
    scalePct: Math.round((Number(s.uiScale) || 1) * 100),
    presence: s.discordPresence !== false,
    beta,
    dotaPath: s.dotaGamePath || '',
    dotaValid: Boolean(s.dotaPathValid),
    cache: `${fmtMB(cacheSize)} MB`,
    vrf: vrf ? { ready: Boolean(vrf.ready), size: `${fmtMB(vrf.ready ? vrf.installedBytes : vrf.downloadBytes)} MB` } : null,
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
function flip(field: 'presence' | 'adult'): boolean {
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
    toast(lang === 'ru' ? L`Язык переключён на Русский` : L`Язык переключён на English`);
    renderSettings();
  },
  scale: (pct, live) => { if (live) paintScale(clampScale(pct)); else setEverything(pct); },
  scaleStep: (delta) => setEverything(delta === null ? 100 : currentScalePct() + delta),
  presence: async () => {
    state.settings = await window.api.settings.set('discordPresence', flip('presence'));
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

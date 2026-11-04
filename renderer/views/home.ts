/* Home (3.0): where the window opens, and where the name in the title bar leads.
 *
 * It answers one question at a glance: what is new, and where to go next. The ways into the
 * sections carry what is in each right now, the catalog's newest mods are its loudest part (they
 * are pictures, and they change every week), and what this version changed, the news the signed
 * config carries and anything about the game that needs the user sit under them. Everything here
 * is also somewhere else; Home is where it is all seen at once. */
import { registerView, switchView } from '../core/router.ts';
import { state } from '../core/store.ts';
import { paint } from '../ui/transitions.ts';
import { refreshNotices } from '../ui/notice.ts';
import { showWhatsNew } from '../ui/dialog.ts';
import { allowItemTable } from '../ui/game-files.ts';
import { recentMods } from './catalog/screens.ts';
import { openModWindow } from './catalog/mod-window.ts';
import { newCount } from './studio-seen.ts';
import { HELP_LINKS } from '../core/constants.ts';
import { showHome } from '../home/root.tsx';
import { latestNews, notePoints, shortCount, RECENT_SHOWN, type HomeDest, type HomeModel, type HomeStatus } from '../home/model.ts';
import type { Mod } from '../catalog/types.ts';

registerView('home', () => renderHome());
window.addEventListener('mm:catalog', () => refreshHome());

const REPO = 'https://github.com/dota2modmanager/dota2-mod-manager';
const SITE = () => (window.I18N_LANG === 'ru' ? 'https://dota2modmanager.com/ru/' : 'https://dota2modmanager.com/');
const DISCORD = HELP_LINKS.discord;

let stars: number | null = null;

async function dests(): Promise<HomeDest[]> {
  const [mods, presets] = await Promise.all([
    window.api.mods.list().catch(() => null),
    window.api.presets.list().catch(() => []),
  ]);
  const installed = mods?.installed || [];
  const on = installed.filter((r) => r.enabled !== false).length;
  const picks = state.cosmeticPicks.size;
  const fresh = newCount();
  return [
    { view: 'catalog', icon: 'grid_view', title: L`Каталог`,
      line: state.modIndex.size ? L`${shortCount(state.modIndex.size)} модов от сообщества` : L`Моды от сообщества` },
    { view: 'items', icon: 'checkroom', title: L`Предметы`,
      line: picks ? L`Конструктор героев, надето: ${picks}` : L`Конструктор героев и виды из игры` },
    { view: 'studio', icon: 'construction', title: L`Мастерская`, fresh: fresh > 0,
      line: fresh ? L`Новых инструментов: ${fresh}` : L`Инструменты из файлов игры` },
    { view: 'library', icon: 'inventory_2', title: L`Мои моды`,
      line: installed.length ? L`Стоит ${installed.length}, включено ${on}` : L`Пока ничего не стоит` },
    { view: 'presets', icon: 'bookmarks', title: L`Пресеты`,
      line: presets.length ? L`Сохранено: ${presets.length}` : L`Готовые наборы и свои` },
  ];
}

/** What about the game needs the user now; with nothing, one line saying it all works. */
function status(tableOff: number): HomeStatus[] {
  const s = state.settings;
  const out: HomeStatus[] = [];
  if (!s?.dotaPathValid) {
    out.push({ id: 'path', icon: 'folder_off', tone: 'warn', text: L`Dota 2 не найдена: моды некуда ставить`,
      action: { label: L`Указать путь`, run: () => switchView('settings') } });
  }
  if (state.masterOff) out.push({ id: 'master', icon: 'toggle_off', tone: 'warn', text: L`Все моды выключены переключателем «Моды» внизу` });
  if (tableOff) {
    out.push({ id: 'table', icon: 'table_view', tone: 'warn', text: L`Виды из игры и эффекты модов ждут таблицу предметов: ${tableOff}`,
      action: { label: L`Включить`, run: async () => { if (await allowItemTable()) void renderHome(); } } });
  }
  const st = state.patchState;
  if (s?.schemaPatch && st && (st.stale || !st.patched || (st.signable && !st.signed))) {
    out.push({ id: 'repair', icon: 'build', tone: 'warn', text: L`Обновление Dota стёрло правку в файлах игры. Она вернётся при запуске кнопкой «Играть»` });
  }
  if (!out.length && s?.dotaPathValid) out.push({ id: 'ok', icon: 'check_circle', tone: 'ok', text: L`Всё работает: Dota найдена, моды на месте` });
  return out;
}

async function model(): Promise<HomeModel> {
  const [version, notes, notices] = await Promise.all([
    window.api.update.version().catch(() => ''),
    window.api.update.notes(window.I18N_LANG || 'en').catch(() => null),
    refreshNotices().catch(() => ({ notices: [] })),
  ]);
  // the same count My mods' banner uses (views/library/build.ts)
  const patch = (state.patchState || {}) as { mods?: number; cosmeticsPicked?: number };
  const tableOff = state.settings?.schemaPatch || state.masterOff ? 0 : (patch?.mods || 0) + (patch?.cosmeticsPicked || 0);
  return {
    version,
    stars,
    dests: await dests(),
    recent: recentMods().slice(0, RECENT_SHOWN),
    notes: notePoints(notes?.notes),
    news: latestNews(notices.notices),
    status: status(tableOff),
  };
}

const actions = {
  go: (view: string) => switchView(view),
  openMod: (mod: Mod, from: Element | null) => openModWindow(mod._cat || '', mod, from),
  allRecent: async () => { state.activeCategory = 'all'; await switchView('catalog'); document.getElementById('recentAll')?.click(); },
  allNotes: () => showWhatsNew({ force: true }),
  open: (url: string) => window.api.misc.openExternal(url),
  links: { repo: REPO, site: SITE, discord: DISCORD },
};
export type HomeActions = typeof actions;

export async function renderHome(): Promise<void> {
  const m = await model();
  if (state.view !== 'home') return;
  await paint(() => showHome(m, actions));
  // the star count comes from the network: drawn again once it is here, if it changed
  if (stars === null) {
    const n = await window.api.update.stars().catch(() => null);
    if (n !== null && n !== stars) { stars = n; if (state.view === 'home') showHome({ ...m, stars }, actions); }
  }
}

/** Draw Home again if it is showing: the catalog or the game state it reads changed. */
export function refreshHome(): void {
  if (state.view === 'home') void renderHome();
}

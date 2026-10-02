/* The Catalog: everything on offer, and the one screen that puts it on screen.
 *
 * This file is the screen's front: what the rail and the screen can ask for, which screen is on
 * show, and the banners over it. Its parts live beside it in views/catalog/: the data it reads
 * (lists.ts), the screens (screens.ts), the overlay its windows share (overlay.ts), a mod's window
 * (mod-window.ts), installing (install.ts) and the free looks (cosmetics.ts). What they draw with
 * is catalog/, in React. */
import { $ } from '../core/dom.ts';
import { COSMETIC_PREFIX, RAIL_SECTIONS, freshFilters } from '../core/constants.ts';
import { state } from '../core/store.ts';
import { registerView } from '../core/router.ts';
import { pickedIn } from '../core/installed.ts';
import { catName, catIcon } from '../core/categories.ts';
import { toast } from '../ui/toast.ts';
import { paint } from '../ui/transitions.ts';
import { refreshSidebarStatus } from '../ui/statusbar.ts';
import { refreshNotices, noticeBannerHtml, bindNotice } from '../ui/notice.ts';
import { bindItemBuilder, openItemHeroModal } from './item-builder.ts';
import { itemRailEntry } from './item-hub.ts';
import { setHeroLayout } from './hero-grid.ts';
import { showScreen } from '../catalog/screen/root.tsx';
import type { ScreenActions } from '../catalog/screen/model.ts';
import { renderRail as drawRail, type RailModel } from '../catalog/rail/Rail.tsx';
import { bannerLayer } from '../catalog/layers.ts';
import type { Mod } from '../catalog/types.ts';
import { buildModIndex, cosmeticSlotList, favoriteCosmetics, favoriteMods, isItemCosmeticSlot, visibleCategories } from './catalog/lists.ts';
import { renderCategory, renderCosmeticCategory, renderFavorites, renderHome, renderSearchResults } from './catalog/screens.ts';
import { openModWindow } from './catalog/mod-window.ts';
import { afterCosmeticPick, openCosmeticWindow, pickCosmetic } from './catalog/cosmetics.ts';
import { screen, view } from './catalog/state.ts';

registerView('catalog', () => renderCatalog());

// ---------- the rail (catalog/rail/Rail.tsx) ----------

function railModel(): RailModel {
  const cats = new Set(visibleCategories().map((c) => c.id));
  const favCount = favoriteMods().length + favoriteCosmetics().length;
  const sections: RailModel['sections'] = [{ label: null, items: [
    { id: 'all', icon: 'apps', name: L`Все категории` },
    { id: 'favorites', icon: 'favorite', name: L`Избранное`, count: favCount, fav: true },
  ] }];
  for (const [label, ids] of RAIL_SECTIONS as [string, string[]][]) {
    const present = ids.filter((id) => cats.has(id));
    if (present.length) sections.push({ label: tr(label), items: present.map((id) => ({ id, icon: catIcon(id), name: catName(id) })) });
  }
  // Free cosmetics only work once safe mode is off (the patch is what lets the game read them at
  // all): showing the section without that would just be a list of dead buttons.
  const cos = cosmeticSlotList();
  if (cos.length) {
    const items = cos
      .filter((x) => !isItemCosmeticSlot(x.slot)) // the builder's slots have one entry of their own
      .map((s) => {
        const id = COSMETIC_PREFIX + s.slot;
        return { id, icon: catIcon(id), name: catName(id), dot: Boolean(pickedIn(s.slot)) };
      });
    const builder = itemRailEntry();
    if (builder) items.push(builder);
    sections.push({ label: L`Косметика`, items });
  }
  return { active: state.activeCategory, sections };
}

function pickCategory(id: string): void {
  state.activeCategory = id;
  view.filters = freshFilters();
  view.cosSearch = '';
  if (state.search) {
    state.search = '';
    ($('#globalSearch') as HTMLInputElement).value = '';
    $('#clearSearch').classList.add('hidden');
  }
  renderCatalog();
}

function renderRail(): void {
  drawRail($('#catRail'), railModel(), pickCategory);
}

// ---------- the screen (catalog/screen/) ----------

/** What the screen can ask for (catalog/screen/model.ts, ScreenActions). */
const actions: ScreenActions = {
  openCategory: async (id) => {
    state.activeCategory = id;
    view.filters = freshFilters();
    await renderCatalog(); // the grid has to exist before it can be scrolled to the top
    $('#main').scrollTop = 0;
  },
  filter: (patch) => {
    Object.assign(view.filters, patch);
    renderCatalog();
  },
  toggleTag: (tag) => {
    const tags = view.filters.tags;
    if (tags.has(tag)) tags.delete(tag);
    else tags.add(tag);
    renderCatalog();
  },
  // the way back and the grid/list switch both end on the whole category, unpicked
  allHeroes: () => {
    view.filters.hero = '';
    renderCatalog();
  },
  layout: (v) => {
    setHeroLayout(v);
    actions.allHeroes();
  },
  pickHero: (hero) => {
    // the mods no hero claims have no entry in the hero dropdown: they sit last in the list
    if (!hero) setHeroLayout('list');
    view.filters.hero = hero;
    renderCatalog();
    $('#main')?.scrollTo({ top: 0 });
  },
  retry: () => loadCatalog(true),
  openMod: (mod: Mod, card) => openModWindow(mod._cat || '', mod, card),
  favChanged: () => {
    if (state.view !== 'catalog') return;
    // in a list that IS the favourites, the card has to leave it
    if (state.activeCategory === 'favorites' || view.filters.favOnly) renderCatalog();
    else renderRail();
  },
  openCosmetic: (slot, id, card) => openCosmeticWindow(slot, id, card),
  cosmeticFavChanged: () => actions.favChanged(),
  cosmeticFilter: ({ search, ...patch }) => {
    Object.assign(view.filters, patch);
    if (search !== undefined) view.cosSearch = search;
    renderCatalog();
  },
  openHero: (hero, card) => openItemHeroModal(hero, card),
};

async function renderCatalog(): Promise<void> {
  const cat = state.catalog;
  if (!cat || cat.error) {
    bannerLayer().replaceChildren();
    await paint(() => showScreen(cat
      ? { kind: 'offline', offline: Boolean(cat.offline), error: String(cat.error) }
      : { kind: 'loading' }, actions));
    return;
  }

  renderRail();
  await refreshNotices();

  const active = state.activeCategory;
  if (state.search.trim()) await renderSearchResults(actions);
  else if (active === 'all') await renderHome(actions);
  else if (active === 'favorites') await renderFavorites(actions);
  else if (active.startsWith(COSMETIC_PREFIX)) await renderCosmeticCategory(active.slice(COSMETIC_PREFIX.length), actions);
  else await renderCategory(active, actions);
  // the no-game banner goes on last so it ends up on top: a user with no Dota has a more
  // pressing problem than whatever the network wanted to say
  const banners = bannerLayer();
  banners.replaceChildren();
  showNoticeBanner(banners);
  showNoGameBanner(banners);
}

/* A notice that arrived from the network (see ui/notice.ts). Drawn after the screen, the same way
 * the no-game banner is, so no category screen has to know about it. */
function showNoticeBanner(banners: HTMLElement): void {
  const html = noticeBannerHtml();
  if (!html) return;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  banners.prepend(holder.firstElementChild as Element);
  bindNotice(banners, () => renderCatalog());
}

/* Without Dota there is a catalog and no way to install from it, and the only sign of that
 * used to be a grey line in the status bar - the news arrived as a refusal, after the click.
 * The banner says it before that, on whichever catalog screen the user is standing on, and
 * carries the two answers with it so nobody has to go looking through Settings. */
function showNoGameBanner(banners: HTMLElement): void {
  if (state.settings?.dotaPathValid) return;
  const el = document.createElement('div');
  el.className = 'banner warn';
  el.innerHTML = `
    <span class="ms">warning</span>
    <div class="banner-body"><b>${L`Dota 2 не найдена`}</b>${L` — моды ставить некуда. Проверь, что игра установлена, или укажи её папку вручную.`}</div>
    <button class="btn btn-sm" id="findDotaBtn"><span class="ms">search</span>${L`Искать снова`}</button>
    <button class="btn btn-sm btn-primary" id="pickDotaBtn"><span class="ms">folder_open</span>${L`Указать папку`}</button>`;
  banners.prepend(el);

  const settled = async (found: boolean) => {
    state.settings = await window.api.settings.get();
    await refreshSidebarStatus();
    if (found) toast(L`Dota 2 найдена — можно ставить моды`);
    renderCatalog();
  };
  $('#findDotaBtn').addEventListener('click', async () => {
    const found = await window.api.settings.detectDota();
    if (!found) { toast(L`Не нашёл автоматически — укажи папку вручную`, 'warn'); return; }
    settled(true);
  });
  $('#pickDotaBtn').addEventListener('click', async () => {
    const r = await window.api.settings.browseDota();
    if (r?.error) { toast(r.error, 'error', 6000); return; }
    if (r?.path) settled(true);
  });
}

// ---------- loading ----------

const CATALOG_MAX_AGE = 30 * 60 * 1000;

export async function loadCatalog(force = false): Promise<void> {
  if (force) toast(L`Обновляю каталог…`);
  state.catalog = null;
  if (state.view === 'catalog') renderCatalog();
  const cat = await window.api.catalog.load(force);
  state.catalog = cat;
  if (!cat.error) buildModIndex();
  if (state.view === 'catalog') renderCatalog();
  // The list is on screen and it is yesterday's: say so once rather than pretend it is fresh
  // or throw the whole thing away, which is what an empty window during a GitHub outage is.
  if (cat.stale) toast(L`Каталог не обновился, показан последний загруженный`, 'warn');
  else if (force && !cat.error) toast(L`Каталог обновлён`);

  // cached catalog goes stale fast (new mods appear upstream) - refresh in the background
  if (!force && !cat.error && Date.now() - (cat.fetchedAt || 0) > CATALOG_MAX_AGE) {
    window.api.catalog.load(true).then((fresh: { error?: string }) => {
      if (fresh.error) return;
      state.catalog = fresh;
      buildModIndex();
      if (state.view === 'catalog') renderCatalog();
    });
  }
}

// what the window's parts reach back into the screen for (views/catalog/state.ts)
screen.redraw = renderCatalog;
screen.rail = renderRail;
screen.favChanged = actions.favChanged;
// The item builder lives in views/item-builder.ts and reaches the catalog only through this.
bindItemBuilder({ pickCosmetic, afterPick: afterCosmeticPick, actions });

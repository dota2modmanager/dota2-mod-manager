/* The catalog's screens as catalog/screen/Screen.tsx draws them: the favourites, the home page,
 * the search results, one category, one slot of free looks. Each works out its model and hands it
 * over inside paint(), so a view transition captures the new screen whole. */
import { arcanaLead } from './arcana.ts';
import { RAW_BASE, COSMETIC_PREFIX, cosmeticMeta } from '../../core/constants.ts';
import { state } from '../../core/store.ts';
import { pickedIn, refreshCosmeticSlots } from '../../core/installed.ts';
import { catName, catIcon } from '../../core/categories.ts';
import { isAdult, adultShown } from '../../core/adult.ts';
import { plural } from '../../ui/format.ts';
import { heroName, catalogMatchesSearch } from '../../ui/hero-name.ts';
import { cosmeticNameMatches } from '../../ui/cosmetic-name.ts';
import { paint } from '../../ui/transitions.ts';
import { heroOf, heroMatches, heroGridWanted, heroTiles, heroLayout } from '../hero-grid.ts';
import { renderItemCosmeticHub } from '../item-hub.ts';
import { canBeInstalled } from '../../catalog/mods.ts';
import { collectTags, collectGroups } from '../../catalog/tags.ts';
import { narrowed as filtersNarrowed } from '../../catalog/filters.ts';
import { favKey } from '../../catalog/favorites.ts';
import { isInstalled } from '../../catalog/looks.ts';
import { catalogConstants, catalogData } from '../../catalog/data.ts';
import { showScreen } from '../../catalog/screen/root.tsx';
import type { ScreenActions, ToolbarModel } from '../../catalog/screen/model.ts';
import type { CosmeticItem } from '../../catalog/cosmetic/CosmeticCard.tsx';
import type { Mod } from '../../catalog/types.ts';
import { applyFilters, categoryMods, collectSlots, cosmeticFavValue, favoriteCosmetics, favoriteMods, filterCosmetics,
  isGroupedCategory, searchCosmetics, tagLabel, visibleCategories, type Look } from './lists.ts';
import { view } from './state.ts';

const NOTHING = () => L`Ничего не найдено — сбрось фильтры`;

/** Looks as the cards draw them (catalog/cosmetic/CosmeticCard.tsx). */
const cosmeticItems = (list: Look[], withCat = false): CosmeticItem[] => list.map(({ slot, o }) => ({
  slot,
  id: o.id,
  name: o.name,
  favKey: favKey(COSMETIC_PREFIX + slot, cosmeticFavValue(slot, o)),
  picked: pickedIn(slot)?.itemId === o.id,
  fallbackIcon: cosmeticMeta(slot).icon,
  catName: withCat ? catName(COSMETIC_PREFIX + slot) : undefined,
}));

export async function renderFavorites(actions: ScreenActions): Promise<void> {
  const all = favoriteMods();
  const mods = applyFilters(all);
  // starred looks live in the same list, kept in their own section: they install a slot of
  // the game's own schema rather than a file, so mixing them into the mod grid would lie
  const cosAll = favoriteCosmetics();
  const cos = filterCosmetics(cosAll);
  const installable = all.some(canBeInstalled) || cosAll.length > 0;
  const empty = !all.length && !cosAll.length;

  await paint(() => showScreen({
    kind: 'list',
    key: 'favorites',
    title: L`Избранное`,
    toolbar: empty ? null : toolbarModel(mods.length + cos.length, { installable, fav: false }),
    note: empty ? L`Здесь пусто — жми на сердечко у мода в каталоге` : undefined,
    mods: all.length ? { heading: cosAll.length > 0, mods, withCat: true, emptyText: NOTHING() } : null,
    cosmetics: cosAll.length ? { items: cosmeticItems(cos, true), emptyText: NOTHING() } : null,
  }, actions));
}

export async function renderHome(actions: ScreenActions): Promise<void> {
  const recent = (catalogData()?.mods?.recentlyAddedMods || [])
    .map((r) => {
      const hit = state.modIndex.get(r.name.toLowerCase());
      return hit ? { ...hit.mod, _cat: hit.categoryId } as Mod : null;
    })
    .filter((m): m is Mod => Boolean(m && (adultShown() || !isAdult(m))))
    .slice(0, 12);
  const tiles = visibleCategories().map((c) => ({
    id: c.id,
    name: catName(c.id),
    preview: c.preview ? `${RAW_BASE}/assets/previews/categories/${encodeURIComponent(c.preview)}` : null,
  }));
  await paint(() => showScreen({ kind: 'home', recent, tiles }, actions));
}

// how many looks a search shows before it just says how many more there are: a query like
// "loading" matches a couple of thousand of them
const COS_SEARCH_LIMIT = 120;

export async function renderSearchResults(actions: ScreenActions): Promise<void> {
  const q = state.search.trim().toLowerCase();
  let mods: Mod[] = [];
  for (const c of visibleCategories()) {
    for (const m of categoryMods(c.id)) {
      if (m.name && catalogMatchesSearch(m.name, q)) mods.push({ ...m, _cat: c.id });
    }
  }
  // the search reaches the free cosmetics too, in their own section below the mods
  const cosAll = searchCosmetics(q);
  // whether the "Установленные" chip makes sense at all - decided before filtering, or the chip
  // would vanish once it filtered everything out and could never be undone
  const installable = mods.some(canBeInstalled) || cosAll.length > 0;
  mods = applyFilters(mods);
  const cos = filterCosmetics(cosAll);
  const shownCos = cos.slice(0, COS_SEARCH_LIMIT);

  await paint(() => showScreen({
    kind: 'list',
    key: 'search',
    title: L`Поиск:`,
    accent: state.search.trim(),
    toolbar: toolbarModel(mods.length + cos.length, { installable }),
    note: !mods.length && !cos.length ? L`Ничего не найдено` : undefined,
    mods: mods.length ? { heading: cos.length > 0, mods, withCat: true } : null,
    cosmetics: cos.length ? {
      items: cosmeticItems(shownCos, true),
      more: cos.length > shownCos.length ? L`…и ещё ${cos.length - shownCos.length} — уточни запрос` : undefined,
    } : null,
  }, actions));
}

export async function renderCategory(categoryId: string, actions: ScreenActions): Promise<void> {
  const f = view.filters;
  const all = categoryMods(categoryId).map((m) => ({ ...m, _cat: categoryId }));
  // the one category the catalog leaves flat, and the only one where the eye is looking for
  // a hero rather than reading 463 names in a row
  const byHero = categoryId === 'heroes';
  if (byHero) for (const m of all) m._group = heroOf(m.name);
  const tags = collectTags(all);
  const slots = collectSlots(all, categoryId);
  // hero dropdowns are long enough that catalog order is useless - sort them A-Z
  const groups = isGroupedCategory(categoryId) ? collectGroups(all) : [];
  if (categoryId === 'hero-items') groups.sort((a, b) => a.localeCompare(b));
  const heroes = byHero
    ? (catalogConstants().HEROES_LIST || [])
      .filter((h) => all.some((m) => heroMatches(h, m.name)))
      .sort((a, b) => a.localeCompare(b))
    : [];
  const mods = applyFilters(all, categoryId);
  const installable = all.some(canBeInstalled);
  const toolbar = toolbarModel(mods.length, { tags, slots, groups, heroes, categoryId, installable });
  if (byHero && heroGridWanted(f)) {
    const tiles = await heroTiles(mods, (cat: string, m: object) => isInstalled(cat, m as Mod));
    await paint(() => showScreen({ kind: 'heroes', key: `cat:${categoryId}:heroes`, title: catName(categoryId), toolbar, tiles }, actions));
    return;
  }

  // Picking one hero out of the dropdown already answers the question the headings answer,
  // so the grid stops repeating it.
  const grouped = (isGroupedCategory(categoryId) || byHero) && !f.group && !f.hero && f.sort === 'default';
  // hero groups are ours rather than the catalog's, so the order is ours to make: A-Z, with
  // the mod that names no hero at the end rather than in the middle of the alphabet
  if (grouped && byHero) mods.sort((a, b) => (a._group ? 0 : 1) - (b._group ? 0 : 1) || String(a._group).localeCompare(String(b._group)));

  // the arcana the app builds itself leads the tools, unless the toolbar narrows it away
  const lead = categoryId === 'tools' && !f.favOnly ? await arcanaLead() : null;
  await paint(() => showScreen({
    kind: 'list',
    key: `cat:${categoryId}`,
    title: (byHero && heroName(f.hero)) || catName(categoryId),
    back: byHero && Boolean(f.hero),
    toolbar,
    lead: lead && (!f.installedOnly || lead.installed) ? lead : null,
    mods: { heading: false, mods, grouped, emptyText: NOTHING() },
    cosmetics: null,
  }, actions));
}

export async function renderCosmeticCategory(slot: string, actions: ScreenActions): Promise<void> {
  if (slot === 'items') return renderItemCosmeticHub();
  const meta = cosmeticMeta(slot);
  const waiting = (note: string) => paint(() => showScreen(
    { kind: 'list', key: `cos:${slot}:note`, title: tr(meta.label), toolbar: null, note, mods: null, cosmetics: null }, actions));
  await waiting(L`Читаем схему игры…`);
  if (!state.cosmeticSlots) await refreshCosmeticSlots();
  if (state.activeCategory !== COSMETIC_PREFIX + slot) return; // moved on while reading

  const data = (state.cosmeticSlots || []).find((s) => s.slot === slot);
  if (!data) {
    await waiting(L`Схема игры не прочиталась — проверь путь к Dota 2 в настройках.`);
    return;
  }

  const f = view.filters;
  const q = view.cosSearch.trim().toLowerCase();
  let list: Look[] = data.options.map((o) => ({ slot, o }));
  if (q) list = list.filter(({ o }) => cosmeticNameMatches(o.name, q));
  list = filterCosmetics(list);
  // same rule as the mod grid: a number only once the list in front of you is a subset
  const narrow = Boolean(view.cosSearch.trim() || f.installedOnly || f.favOnly);
  await paint(() => showScreen({
    kind: 'cosmetics',
    key: `cos:${slot}`,
    title: tr(meta.label),
    sort: f.sort,
    search: view.cosSearch,
    installedOnly: f.installedOnly,
    favOnly: f.favOnly,
    count: narrow ? `${list.length} ${plural(list.length, 'результат', 'результата', 'результатов')}` : '',
    items: cosmeticItems(list.slice(0, 400)), // search narrows the rest; nobody scrolls past this
  }, actions));
}

// ---------- the toolbar (catalog/screen/Toolbar.tsx) ----------

const GROUP_LABEL: Record<string, string> = {
  'hero-items': 'Все герои', 'item-effects': 'Все предметы', creeps: 'Все крипы', towers: 'Все башни', 'creep-deny': 'Все типы',
};

// Is the list in front of you shorter than the category itself? That, and only that, is when
// a number of results is worth printing: it answers "did that chip do anything". Sorting is
// not narrowing - the same mods come back in another order - so it does not count.
const narrowed = () => filtersNarrowed(view.filters) || Boolean(state.search.trim());

interface ToolbarParts {
  tags?: string[]; slots?: string[]; groups?: string[]; heroes?: string[];
  categoryId?: string | null; installable?: boolean; fav?: boolean;
}

function toolbarModel(resultCount: number,
  { tags = [], slots = [], groups = [], heroes = [], categoryId = null, installable = true, fav = true }: ToolbarParts): ToolbarModel {
  const f = view.filters;
  return {
    resultCount,
    showCount: narrowed(),
    sort: f.sort,
    heroes,
    hero: f.hero,
    groups,
    group: f.group,
    groupLabel: tr(GROUP_LABEL[categoryId || ''] || 'Все группы'),
    groupIcon: categoryId === 'hero-items' ? 'person' : (categoryId && catIcon(categoryId)) || 'group',
    slots: slots.map((s) => ({ id: s, label: tagLabel(categoryId, s) })),
    slot: f.slot,
    installable,
    installedOnly: f.installedOnly,
    fav,
    favOnly: f.favOnly,
    tags: tags.map((t) => ({ id: t, label: tagLabel(categoryId, t), on: f.tags.has(t) })),
    layout: categoryId === 'heroes' ? heroLayout() : null,
  };
}

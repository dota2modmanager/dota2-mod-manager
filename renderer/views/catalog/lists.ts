/* What the catalog reads out of the data it holds: a category's mods, the starred ones, the free
 * looks a search or the favourites reach, the user's own packs. Nothing is drawn here.
 *
 * What is offered comes from the upstream catalog (src/catalog.ts via loadCatalog), which is why
 * the mod index is built here: it is a reading of the same data. */
import { COSMETIC_PREFIX, CATALOG_EXCLUDE, TOOLS_HIDDEN } from '../../core/constants.ts';
import { state } from '../../core/store.ts';
import { pickedIn } from '../../core/installed.ts';
import { shownMods, isAdult, adultShown } from '../../core/adult.ts';
import { heroMatches } from '../hero-grid.ts';
import { cosmeticMatchesSearch } from '../../ui/hero-name.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import { officialOnly } from '../../catalog/source.ts';
import { modsOf, isGrouped, modIndexOf, type CustomPack } from '../../catalog/mods.ts';
import { tagLabel as labelOfTag, collectSlots as slotsOf } from '../../catalog/tags.ts';
import { applyFilters as filterMods, sortMods } from '../../catalog/filters.ts';
import { isFav } from '../../catalog/favorites.ts';
import { isInstalled } from '../../catalog/looks.ts';
import { catalogConstants, catalogData } from '../../catalog/data.ts';
import type { CosmeticOption, CosmeticSlot, Mod } from '../../catalog/types.ts';
import { view } from './state.ts';

/** One free look, and the slot it goes in. */
export interface Look { slot: string; o: CosmeticOption }

// ---------- mods ----------

/** The packs the user made, kept in the window's storage. */
export function customPacks(): CustomPack[] {
  try {
    return JSON.parse(localStorage.getItem('customPacks') || '[]');
  } catch {
    return [];
  }
}

export function saveCustomPacks(packs: CustomPack[]): void {
  localStorage.setItem('customPacks', JSON.stringify(packs));
}

const modsData = (categoryId: string) => catalogData()?.mods?.modsData?.[categoryId];
const allCategoryMods = (categoryId: string): Mod[] =>
  modsOf(modsData(categoryId), categoryId, { toolsHidden: TOOLS_HIDDEN, customPacks: customPacks() });
/** What browsing shows: without the adult mods until the user said yes (core/adult.ts). */
export const categoryMods = (categoryId: string): Mod[] => officialOnly() ? [] : shownMods(allCategoryMods(categoryId));
export const isGroupedCategory = (categoryId: string): boolean => isGrouped(modsData(categoryId));

export function visibleCategories(): { id: string; preview?: string }[] {
  return (catalogConstants().categories || []).filter((c) => !CATALOG_EXCLUDE.includes(c.id) && categoryMods(c.id).length);
}

/** state.modIndex, filled in place: other screens hold the same Map. */
export function buildModIndex(): void {
  const index = modIndexOf(catalogConstants().categories || [], allCategoryMods);
  state.modIndex.clear();
  for (const [name, hit] of index) state.modIndex.set(name, hit);
}

export const tagLabel = (categoryId: string | null, tag: string): string =>
  labelOfTag(tag, categoryId ? catalogConstants().TAG_CONFIGS?.[categoryId]?.map : undefined);
export const collectSlots = (mods: Mod[], categoryId: string): string[] => slotsOf(mods, (t) => tagLabel(categoryId, t));

/** The toolbar's narrowing and order (catalog/filters.ts), on a list of mods. */
export function applyFilters(mods: Mod[], catForInstalled = ''): Mod[] {
  return filterMods(mods, view.filters, {
    isInstalled: (m) => isInstalled(m._cat || catForInstalled, m),
    isFav: (m) => isFav(m._cat || catForInstalled, m.name),
    heroMatches,
  });
}

export function findModByName(cat: string, name: string): Mod | null {
  if (cat === 'packs') {
    const custom = customPacks().find((p) => p.name === name);
    if (custom) return { ...custom, _cat: 'packs' };
  }
  const hit = state.modIndex.get(name.toLowerCase());
  return hit ? { ...hit.mod, _cat: hit.categoryId } : null;
}

/** Starred mods resolved back to catalog entries (a mod dropped from the catalog is skipped). */
export function favoriteMods(): Mod[] {
  if (officialOnly()) return [];
  const out: Mod[] = [];
  for (const key of state.favorites as Set<string>) {
    if (key.startsWith(COSMETIC_PREFIX)) continue; // a look, not a mod: favoriteCosmetics()
    const cut = key.indexOf('|');
    if (cut < 0) continue;
    const mod = findModByName(key.slice(0, cut), key.slice(cut + 1));
    if (mod && (adultShown() || !isAdult(mod))) out.push(mod);
  }
  return out;
}

// ---------- free looks ----------

// Cosmetics only work with the schema patch on, so with safe mode they are not offered
// anywhere: the rail, the favourites, the search all ask here first.
export function cosmeticSlotList(): CosmeticSlot[] {
  return state.settings?.schemaPatch || officialOnly() ? (state.cosmeticSlots || []) : [];
}

export function slotData(slot: string): CosmeticSlot | null {
  return cosmeticSlotList().find((s) => s.slot === slot) || null;
}

/** A hero's item, which the item builder (views/item-builder.ts) puts on rather than a slot of its own. */
export function isItemCosmeticSlot(slot: string): boolean {
  const s = String(slot || '');
  return slotData(s)?.kind === 'item-effect' || s === 'items' || s.startsWith('item:');
}

/** What a star keeps of a look: the builder's items by id, the rest by name. */
export const cosmeticFavValue = (slot: string, o: CosmeticOption): string => (isItemCosmeticSlot(slot) ? o.id : o.name);

/** One look, by the id the schema gave it or by its name (favourites are stored by name). */
export function findCosmetic(slot: string, idOrName: string): CosmeticOption | null {
  const data = slotData(slot);
  if (!data) return null;
  return data.options.find((o) => o.id === idOrName) || data.options.find((o) => o.name === idOrName) || null;
}

/** Starred looks resolved back to slot and option (one Valve dropped is simply skipped). */
export function favoriteCosmetics(): Look[] {
  const out: Look[] = [];
  for (const key of state.favorites as Set<string>) {
    if (!key.startsWith(COSMETIC_PREFIX)) continue;
    const cut = key.indexOf('|');
    if (cut < 0) continue;
    const slot = key.slice(COSMETIC_PREFIX.length, cut);
    const o = findCosmetic(slot, key.slice(cut + 1));
    if (o) out.push({ slot, o });
  }
  return out;
}

/** Every look whose name or Chinese hero label matches, across all slots. */
export function searchCosmetics(q: string): Look[] {
  const out: Look[] = [];
  for (const s of cosmeticSlotList()) {
    for (const o of s.options) {
      if (cosmeticMatchesSearch(`${o.name} ${cosmeticName(o.name)}`, q, s.heroLabel)) out.push({ slot: s.slot, o });
    }
  }
  return out;
}

/** The toolbar's sort, "installed only" and "starred only", on a list of looks. */
export function filterCosmetics(list: Look[]): Look[] {
  const f = view.filters;
  let out = f.installedOnly ? list.filter(({ slot, o }) => pickedIn(slot)?.itemId === o.id) : list;
  if (f.favOnly) out = out.filter(({ slot, o }) => isFav(COSMETIC_PREFIX + slot, cosmeticFavValue(slot, o)));
  return sortMods(out, f.sort, ({ o }) => cosmeticName(o.name));
}

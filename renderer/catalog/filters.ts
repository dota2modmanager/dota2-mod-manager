/* The toolbar's narrowing and sorting, applied to a list of mods. Pure: what counts as installed,
 * starred or belonging to a hero is handed in, so the same rules hold wherever a list is drawn. */
import type { Filters, Mod } from './types.ts';
import { canonTag } from './tags.ts';

interface FilterChecks {
  isInstalled: (m: Mod) => boolean;
  isFav: (m: Mod) => boolean;
  heroMatches: (hero: string, name: string) => boolean;
  /** how many times a mod was downloaded, for the 'popular' sort; 0 when nobody can say */
  downloads?: (m: Mod) => number;
}

const dateOf = (m: Mod): number => m.meta?.date || 0;

/** Sorts a copy by the toolbar's sort; 'default' keeps the catalog's own order. */
export function sortMods<T>(list: T[], sort: string, nameOf: (x: T) => string, date: (x: T) => number = () => 0, downloads: (x: T) => number = () => 0): T[] {
  switch (sort) {
    case 'date': return [...list].sort((a, b) => date(b) - date(a));
    // a stable sort: mods nobody has counted yet keep the catalog's own order among themselves
    case 'popular': return [...list].sort((a, b) => downloads(b) - downloads(a));
    case 'name': return [...list].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    case 'name-desc': return [...list].sort((a, b) => nameOf(b).localeCompare(nameOf(a)));
    default: return list;
  }
}

export function applyFilters(mods: Mod[], f: Filters, checks: FilterChecks): Mod[] {
  let out = mods;
  if (f.group) out = out.filter((m) => m._group === f.group);
  if (f.hero) out = out.filter((m) => checks.heroMatches(f.hero, m.name));
  if (f.tags.size) out = out.filter((m) => [...f.tags].every((t) => m.tags?.[t]));
  if (f.slot) out = out.filter((m) => Object.entries(m.tags || {}).some(([k, v]) => v && canonTag(k) === f.slot));
  if (f.installedOnly) out = out.filter(checks.isInstalled);
  if (f.favOnly) out = out.filter(checks.isFav);
  return sortMods(out, f.sort, (m) => m.name, dateOf, checks.downloads);
}

/** Whether any narrowing is on, beyond the sort. */
export function narrowed(f: Filters): boolean {
  return Boolean(f.tags.size || f.installedOnly || f.favOnly || f.group || f.hero || f.slot);
}

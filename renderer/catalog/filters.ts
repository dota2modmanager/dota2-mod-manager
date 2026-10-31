/* The toolbar's narrowing and sorting, applied to a list of mods. Pure: what counts as installed,
 * starred or belonging to a hero is handed in, so the same rules hold wherever a list is drawn. */
import type { Filters, Mod } from './types.ts';
import { canonTag } from './tags.ts';
import { modCredits } from '../core/credits.ts';

interface FilterChecks {
  isInstalled: (m: Mod) => boolean;
  isFav: (m: Mod) => boolean;
  heroMatches: (hero: string, name: string) => boolean;
  /** how many times a mod was downloaded, for the 'popular' sort; 0 when nobody can say */
  downloads?: (m: Mod) => number;
}

const dateOf = (m: Mod): number => m.meta?.date || 0;

/**
 * Who made a mod, as the catalog credits them (core/credits.ts): its authors, and whoever reworked
 * another author's mod. Whoever only sent it in did not make it. The catalog names them in the mod's
 * links, not in a field of their own: 1582 of its 1767 mods name an author, 16 of them two.
 */
export function modAuthors(m: Mod): string[] {
  return modCredits(m, null).filter((c) => c.role !== 'sender').map((c) => c.name);
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
const madeBy = (m: Mod, author: string) => modAuthors(m).some((a) => sameName(a, author));

/**
 * The authors of a list, each once with how many of its mods are theirs, A-Z. One author written
 * two ways ("h6rd", "H6rd") is one, under the spelling met first.
 */
export function collectAuthors(mods: Mod[]): { name: string; count: number }[] {
  const out: { name: string; count: number }[] = [];
  for (const m of mods) {
    for (const name of new Set(modAuthors(m))) {
      const hit = out.find((a) => sameName(a.name, name));
      if (hit) hit.count++;
      else out.push({ name, count: 1 });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The author a list is narrowed to: the one picked, where the list has mods of theirs. The pick is
 * remembered across categories (catalog/prefs.ts), and an author with nothing in this one would
 * empty it: there it is set aside, and comes back in the next category they have mods in.
 */
export function authorIn(mods: Mod[], author: string): string {
  return author && mods.some((m) => madeBy(m, author)) ? author : '';
}

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
  const author = authorIn(mods, f.author);
  if (author) out = out.filter((m) => madeBy(m, author));
  return sortMods(out, f.sort, (m) => m.name, dateOf, checks.downloads);
}

/** Whether any narrowing is on, beyond the sort. */
export function narrowed(f: Filters): boolean {
  return Boolean(f.tags.size || f.installedOnly || f.favOnly || f.group || f.hero || f.slot || f.author);
}

/* What the catalog remembers of how you look at it: the sort, the author, the "Installed" and
 * "Favorites" chips, and the search in the title bar. Every category used to start over at the
 * catalog's own order, so a sort by newest had to be picked again on each one, and on each start.
 *
 * The rest of the toolbar is the category's own (its tags, slots, groups and heroes mean nothing in
 * another one) and still starts empty. Kept in the window's storage, like the hero grid's layout:
 * it is how this window looks, not something the main process needs to know.
 * Pure: the storage is handed in. */
import type { Filters } from './types.ts';

/** What is remembered. */
export interface CatalogPrefs { sort: string; author: string; installedOnly: boolean; favOnly: boolean; search: string }

/** The toolbar's part of it, which every category starts from. */
export const REMEMBERED = ['sort', 'author', 'installedOnly', 'favOnly'] as const;

const KEY = 'catalogPrefs';
const NONE: CatalogPrefs = { sort: 'default', author: '', installedOnly: false, favOnly: false, search: '' };

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The prefs as stored, each field checked on its own: one that is missing or of the wrong kind is
 * its default, and a sort the window no longer offers is the catalog's own order.
 * @param sorts  the sorts the toolbar offers (core/constants.ts SORTS)
 */
export function readPrefs(store: Store | null, sorts: string[]): CatalogPrefs {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) || '{}');
    if (parsed && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
  } catch { /* unreadable: the defaults */ }
  const text = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
  return {
    sort: sorts.includes(text('sort')) ? text('sort') : NONE.sort,
    author: text('author'),
    installedOnly: raw.installedOnly === true,
    favOnly: raw.favOnly === true,
    search: text('search'),
  };
}

/** Changes some of the prefs, the rest kept. A window that cannot store them just forgets. */
export function writePrefs(store: Store | null, sorts: string[], patch: Partial<CatalogPrefs>): void {
  try {
    store?.setItem(KEY, JSON.stringify({ ...readPrefs(store, sorts), ...patch }));
  } catch { /* storage full or off: nothing to keep it in */ }
}

/** The remembered part of a toolbar change, or null when the change touches none of it. */
export function rememberedOf(patch: Partial<Filters>): Partial<CatalogPrefs> | null {
  const out: Partial<CatalogPrefs> = {};
  for (const k of REMEMBERED) if (k in patch) (out as Record<string, unknown>)[k] = patch[k];
  return Object.keys(out).length ? out : null;
}

/** A category's toolbar to start from: empty, with what is remembered put back. */
export function startingFilters(fresh: Filters, prefs: CatalogPrefs): Filters {
  return { ...fresh, sort: prefs.sort, author: prefs.author, installedOnly: prefs.installedOnly, favOnly: prefs.favOnly };
}

/* The catalog screen's own state, off the shared store now that it has somewhere to live, and
 * what its parts reach back into the screen for. */
import { SORTS, freshFilters } from '../../core/constants.ts';
import { readPrefs, rememberedOf, startingFilters, writePrefs, type CatalogPrefs } from '../../catalog/prefs.ts';
import type { Filters } from '../../catalog/types.ts';

const SORT_KEYS = SORTS.map((s) => s.key);
const storage = (): Storage | null => { try { return localStorage; } catch { return null; } };

/** The remembered sort, author, chips and search (catalog/prefs.ts). */
export const prefs = (): CatalogPrefs => readPrefs(storage(), SORT_KEYS);

/** A category's toolbar to start from: its own parts empty, the remembered ones as they were left. */
export const startFilters = (): Filters => startingFilters(freshFilters(), prefs());

/** Keeps what of a toolbar change, or of the search, is remembered. */
export function remember(patch: Partial<Filters> & { search?: string }): void {
  const { search, ...filters } = patch;
  const keep = { ...rememberedOf(filters), ...(search !== undefined ? { search } : {}) };
  if (Object.keys(keep).length) writePrefs(storage(), SORT_KEYS, keep);
}

/** What the toolbar narrows by, and the search inside one cosmetic slot (its list runs to thousands). */
export const view: { filters: Filters; cosSearch: string } = { filters: startFilters(), cosSearch: '' };

/** Mods with a download in flight, so a card and the window can say so. */
export const installing = new Set<string>();

/* The window's parts (the mod window, the looks, the installs) change what the screen shows. They
 * ask for it here rather than importing the screen, which imports them: views/catalog.ts fills
 * these in once, as it loads. */
export const screen = {
  /** the whole screen again: a pack saved, a category changed */
  redraw: (): Promise<void> | void => undefined,
  /** the rail's counts and dots */
  rail: (): void => undefined,
  /** a star changed somewhere, and a list that is the favourites has to lose or gain a card */
  favChanged: (): void => undefined,
};

/* The catalog's pane holds two sections since 3.0, each with a tab of its own: Catalog, the mods
 * people made, and Items, what the game itself has (the item builder and the looks of the game's
 * standard slots). They used to share one rail, and the second half of it appeared only once safe
 * mode was switched off, so most people never saw the builder at all.
 *
 * The section follows from the category on show: a cosmetic id is Items, anything else Catalog.
 * Each section remembers where it was left, so a tab click returns to it. */
import { COSMETIC_PREFIX } from '../../core/constants.ts';
import { state } from '../../core/store.ts';

export type Section = 'catalog' | 'items';

/** The item builder's hub, where Items opens the first time. */
export const ITEMS_HOME = COSMETIC_PREFIX + 'items';

const isItems = (cat: string): boolean => cat.startsWith(COSMETIC_PREFIX);
const left: Record<Section, string> = { catalog: 'all', items: ITEMS_HOME };

/** Which section a category belongs to. */
export const sectionOf = (cat: string): Section => (isItems(cat) ? 'items' : 'catalog');

/** The section the window is on, by its tab. */
export const sectionOnShow = (): Section => (state.view === 'items' ? 'items' : 'catalog');

/** Put the category back to where this section was left, keeping the other's in memory. */
export function enterSection(section: Section): void {
  const now = state.activeCategory;
  left[sectionOf(now)] = now;
  if (sectionOf(now) !== section) state.activeCategory = left[section];
}

/** A category picked from somewhere else (a link, a search hit): the tab it belongs under. */
export const viewFor = (cat: string): string => (isItems(cat) ? 'items' : 'catalog');

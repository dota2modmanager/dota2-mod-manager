/* The catalog screen's own state, off the shared store now that it has somewhere to live, and
 * what its parts reach back into the screen for. */
import { freshFilters } from '../../core/constants.ts';
import type { Filters } from '../../catalog/types.ts';

/** What the toolbar narrows by, and the search inside one cosmetic slot (its list runs to thousands). */
export const view: { filters: Filters; cosSearch: string } = { filters: freshFilters(), cosSearch: '' };

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

/* The shapes the catalog screen works with: a mod as the upstream catalog ships it
 * (src/catalog.js fetches mods.json and constants.json), plus the few fields this app adds. */

export interface ModStyle {
  label: string;
  file?: string;
  preview?: string;
  [key: string]: unknown;
}

export interface ModLink {
  type?: string;
  url: string;
  [key: string]: unknown;
}

export interface Mod {
  name: string;
  file?: string;
  type?: string;
  preview?: string;
  tags?: Record<string, boolean | undefined>;
  meta?: { date?: number; [key: string]: unknown };
  styles?: ModStyle[];
  links?: ModLink[];
  /** a pack's members */
  mods?: unknown[];
  /** the group a mod sits in, in a category the catalog groups; null everywhere else */
  _group?: string | null;
  _groupId?: string;
  /** a pack the user made, kept in the window's storage */
  _custom?: boolean;
  /** the category, on lists that mix several (favourites, search results) */
  _cat?: string;
  [key: string]: unknown;
}

/** A category's data in mods.json: a flat list, or groups of lists. */
export type CategoryData = Mod[] | { groups?: { name: string; id?: string; mods?: Mod[] }[] };

/** What the toolbar above a grid narrows by (core/constants.js FILTER_DEFAULTS). */
export interface Filters {
  sort: string;
  tags: Set<string>;
  installedOnly: boolean;
  favOnly: boolean;
  group: string;
  hero: string;
  slot: string;
}

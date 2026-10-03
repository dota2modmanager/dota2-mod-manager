/* The catalog as the window holds it (state.catalog, filled by loadCatalog), typed for the code
 * that reads it. */
import type { CategoryData } from './types.ts';
import { state } from '../core/store.ts';

interface CatalogConstants {
  categories?: { id: string; preview?: string }[];
  TAG_CONFIGS?: Record<string, { map?: Record<string, string> } | undefined>;
  addToCartRules?: { hiddenCategories?: string[]; allowedMods?: Record<string, unknown[] | undefined> };
  HEROES_LIST?: string[];
  translations?: Record<string, string>;
  /** a credited name's page, where the catalog has one (core/credits.ts) */
  MOD_AUTHOR?: Record<string, string>;
  MOD_SENDER?: Record<string, string>;
  /** the mascots of the window's themes, by theme (ui/theme.ts) */
  GIF_CONFIG?: { themes?: string[]; gifs?: string[] };
}

export interface CatalogData {
  mods?: { modsData?: Record<string, CategoryData | undefined>; recentlyAddedMods?: { name: string; category: string }[] };
  constants?: CatalogConstants;
  guides?: Record<string, unknown>;
  error?: string;
  offline?: boolean;
  /** the last copy on disk, shown because the fetch failed */
  stale?: boolean;
  fetchedAt?: number;
}

export const catalogData = (): CatalogData | null => state.catalog;
export const catalogConstants = (): CatalogConstants => catalogData()?.constants || {};

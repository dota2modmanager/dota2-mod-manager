/* The catalog as the window holds it (state.catalog, filled by loadCatalog), typed for the code
 * that reads it. core/store.js declares the field as null until the fetch lands, which TypeScript
 * would otherwise read as "always null". */
import type { CategoryData } from './types.ts';
import { state } from '../core/store.js';

export interface CatalogConstants {
  categories?: { id: string; preview?: string }[];
  TAG_CONFIGS?: Record<string, { map?: Record<string, string> } | undefined>;
  addToCartRules?: { hiddenCategories?: string[]; allowedMods?: Record<string, unknown[] | undefined> };
  HEROES_LIST?: string[];
  translations?: Record<string, string>;
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

export const catalogData = (): CatalogData | null => state.catalog as unknown as CatalogData | null;
export const catalogConstants = (): CatalogConstants => catalogData()?.constants || {};

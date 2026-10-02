/* What every screen shares.
 *
 * Split by ownership rather than convenience. Of 254 reads of this object only 38 were
 * writes, and most fields turned out to belong to exactly one screen: which library rows are
 * ticked concerns nobody but the library. Those have moved into the modules that own them,
 * so no other screen can reach them at all.
 *
 * What is left here is the shared cache: what the catalog holds, what the game looks like
 * right now, what the user has installed. Written from few places, read from many.
 *
 * Deliberately a plain object rather than getters and setters. Modules export live bindings,
 * so a getter pair would let any module write any field exactly as it can now, only with
 * more ceremony; the honest fix was shrinking what is shared, not dressing it up.
 */
import { PANEL_DEFAULTS, type Panels } from './constants.ts';
import type { CatalogData } from '../catalog/data.ts';
import type { CosmeticSet, CosmeticSlot, Mod } from '../catalog/types.ts';
import type { LibRecord } from '../library/types.ts';
import type { AppSettings } from '../api/app.ts';
import type { PatchState } from '../api/content.ts';

export interface State {
  view: string;
  catalog: CatalogData | null;
  /** free-cosmetics slots from the game's own schema (safe mode off) */
  cosmeticSlots: CosmeticSlot[] | null;
  /** the item builder's sets (src/item-builder.ts itemSets) */
  cosmeticSets: CosmeticSet[] | null;
  /** src/patcher.ts + schema-service state: patched/signed/conflicts/foreign */
  patchState: PatchState | null;
  /** what settings.json holds (src/settings.ts) */
  settings: AppSettings | null;
  /** written by the shell too: safe mode can retire the open category */
  activeCategory: string;
  /** the title-bar search box, which belongs to the window */
  search: string;
  installedIndex: Map<string, LibRecord>;
  /** slot -> live library record for it (rebuilt from mods:list) */
  cosmeticPicks: Map<string, LibRecord>;
  /** every catalog mod by lower-cased name (views/catalog/lists.ts) */
  modIndex: Map<string, { categoryId: string; mod: Mod }>;
  /** mods master switch state (all mods disabled at once) */
  masterOff: boolean;
  /** starred catalog mods, as "<categoryId>|<name>" keys */
  favorites: Set<string>;
  panels: Panels;
  /** which whole-map terrains are older than the game's map, asked once (core/terrain-age.ts) */
  terrainAges: { stale?: Record<string, boolean> } | null;
}

export const state: State = {
  view: 'catalog',
  catalog: null,
  cosmeticSlots: null,
  cosmeticSets: null,
  patchState: null,
  settings: null,
  activeCategory: 'all',
  search: '',
  installedIndex: new Map(),
  cosmeticPicks: new Map(),
  modIndex: new Map(),
  masterOff: false,
  favorites: new Set(),
  panels: { ...PANEL_DEFAULTS },
  terrainAges: null,
};

/* Every field above is now read from more than one module. The eleven that were not have
 * gone to the screens that owned them, which is what this file was being shrunk towards. */

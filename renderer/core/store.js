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
import { PANEL_DEFAULTS } from './constants.js';

export const state = {
  view: 'catalog',
  catalog: null,
  cosmeticSlots: null,     // free-cosmetics slots from the game's own schema (safe mode off)
  cosmeticSets: null,      // the item builder's sets (src/item-builder.ts itemSets)
  patchState: null,        // src/patcher.ts + schema-service state: patched/signed/conflicts/foreign
  settings: null,
  activeCategory: 'all',   // written by the shell too: safe mode can retire the open category
  search: '',              // the title-bar search box, which belongs to the window
  installedIndex: new Map(),
  cosmeticPicks: new Map(), // slot -> live library record for it (rebuilt from mods:list)
  modIndex: new Map(),
  masterOff: false,        // mods master switch state (all mods disabled at once)
  favorites: new Set(),    // starred catalog mods, as "<categoryId>|<name>" keys
  panels: { ...PANEL_DEFAULTS },
};

/* Every field above is now read from more than one module. The eleven that were not have
 * gone to the screens that owned them, which is what this file was being shrunk towards. */

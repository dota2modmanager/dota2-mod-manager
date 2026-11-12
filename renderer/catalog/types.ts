/* The shapes the catalog screen works with: a mod as the upstream catalog ships it
 * (src/catalog.ts fetches mods.json and constants.json), plus the few fields this app adds. */

export interface ModStyle {
  label: string;
  file?: string;
  preview?: string;
  [key: string]: unknown;
}

interface ModLink {
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

/** A look for one slot, out of the game's own item schema. */
export interface CosmeticOption {
  id: string;
  name: string;
  tags?: string[];
  /** an item builder wearable's styles by name, when it has more than one (src/item-builder-styles.ts) */
  styles?: string[];
  /** what is known to go wrong with it in the game, or that nobody has checked (src/arcana-notes.ts) */
  note?: { status: 'issues' | 'broken' | 'untested'; text: string };
  /** it creates a particle of its own, which another item of the slot can wear (src/item-builder-donor.ts) */
  fx?: boolean;
  /** an item builder wearable's rarity key ("mythical") and release day ("2021-09-01"), src/item-builder-details.ts itemFacts */
  rarity?: string;
  date?: string;
}

/** A slot of free cosmetics, or one of the item builder's (kind 'item-effect', slot 'item:...'). */
export interface CosmeticSlot {
  slot: string;
  kind?: string;
  label?: string;
  slotLabel?: string;
  heroLabel?: string;
  heroIds?: string[];
  /** the stock item the slot dresses, in the item builder's slots */
  targetId?: string;
  icon?: string;
  options: CosmeticOption[];
  effects?: { id: string; name: string }[];
  /** a persona's slot (src/item-builder-personas.ts): `part` false where the persona is picked */
  persona?: { hero: string; part: boolean };
  /** an ability effects slot's number: its picks give their effects, not their model (src/item-builder-ability-fx.ts) */
  abilityFx?: number;
}

/** One piece of an item set, and whether the builder can put it on (src/item-builder.ts itemSets). */
export interface SetPiece {
  slot: string;
  itemId: string;
  name: string;
  fits: boolean;
  reason?: string;
  slotLabel?: string;
  /** the item's rarity as the game names it, for a piece that fits */
  rarity?: string;
}

export interface CosmeticSet {
  id: string;
  name: string;
  heroLabel: string;
  fit: number;
  pieces: SetPiece[];
  /** what the game says about it (src/item-builder-details.ts): a rarity key ("mythical") and its
   * name, "2021-08-18", the event's id ("EVENT_ID_SPRING_2021") and its name in the player's
   * language, the description, and the names of its looks when it has several */
  rarity?: string;
  rarityName?: string;
  date?: string;
  event?: string;
  eventName?: string;
  title?: string;
  description?: string;
  styles?: number;
  styleNames?: string[];
}

/** A hero's main attribute, the four groups of the game's hero grid (src/item-builder-details.ts). */
export type HeroAttribute = 'str' | 'agi' | 'int' | 'all';

/** One pick of a saved look: what goes on a slot, as a pick record has it. */
export interface LookPick { slot: string; itemId: string; name: string; effectId?: string }

/** A hero's saved look (issue #527), kept in the settings under itemLooks, apart from presets. */
export interface ItemLook { id: string; hero: string; name: string; picks: LookPick[]; at: number }

/** What the toolbar above a grid narrows by (core/constants.ts FILTER_DEFAULTS). */
export interface Filters {
  sort: string;
  tags: Set<string>;
  installedOnly: boolean;
  favOnly: boolean;
  group: string;
  hero: string;
  slot: string;
  /** whose mods: a name as the catalog writes it, '' for everybody's */
  author: string;
}

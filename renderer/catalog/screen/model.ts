/* What the catalog screen shows, worked out by views/catalog/screens.ts and drawn by Screen.tsx. The
 * split keeps the rules (which mods, which chips, which heading) where the data is, and the
 * markup in one place per shape. */
import type { Filters, Mod } from '../types.ts';
import type { ArcanaCardModel } from '../arcana/ArcanaCard.tsx';
import type { CosmeticItem } from '../cosmetic/CosmeticCard.tsx';

export interface ToolbarModel {
  resultCount: number;
  /** print the count only when the list is narrower than the category: "did that chip do anything" */
  showCount: boolean;
  sort: string;
  heroes: string[];
  hero: string;
  groups: string[];
  group: string;
  groupLabel: string;
  groupIcon: string;
  slots: { id: string; label: string }[];
  slot: string;
  installable: boolean;
  installedOnly: boolean;
  fav: boolean;
  favOnly: boolean;
  tags: { id: string; label: string; on: boolean }[];
  /** the heroes category's grid/list switch, and which is on */
  layout: 'grid' | 'list' | null;
}

interface GridModel {
  mods: Mod[];
  grouped?: boolean;
  withCat?: boolean;
  emptyText?: string;
}

export interface HeroTileModel {
  hero: string;
  count: number;
  installed: boolean;
  /** the hero's own portrait, a mod's picture standing in for it, or neither */
  art: string | null;
  standIn: boolean;
}

export type ScreenModel =
  | { kind: 'loading' }
  | { kind: 'offline'; offline: boolean; error: string }
  | { kind: 'home'; recent: Mod[]; tiles: { id: string; name: string; preview: string | null }[] }
  | {
    kind: 'list';
    /** a new key is a new screen, entrances and all; the same key updates the one on show */
    key: string;
    title: string;
    accent?: string;
    back?: boolean;
    toolbar: ToolbarModel | null;
    note?: string;
    /** a tool the app has in it, first in the grid (the arcana's, among the tools) */
    lead?: ArcanaCardModel | null;
    mods: (GridModel & { heading: boolean }) | null;
    cosmetics: { items: CosmeticItem[]; emptyText?: string; more?: string } | null;
  }
  | { kind: 'heroes'; key: string; title: string; toolbar: ToolbarModel; tiles: HeroTileModel[] }
  | {
    /** one slot of free looks, with a search of its own: a slot runs to thousands */
    kind: 'cosmetics';
    key: string;
    title: string;
    sort: string;
    search: string;
    installedOnly: boolean;
    favOnly: boolean;
    count: string;
    items: CosmeticItem[];
  }
  | {
    /** the item builder's heroes (views/item-builder.ts) */
    kind: 'builder';
    title: string;
    search: string;
    installedOnly: boolean;
    count: string;
    heroes: { hero: string; icon: string | null; installed: boolean; meta: string }[];
  };

/** What the screen can ask the catalog to do. */
export interface ScreenActions {
  openCategory: (id: string) => void;
  filter: (patch: Partial<Filters>) => void;
  toggleTag: (tag: string) => void;
  allHeroes: () => void;
  layout: (v: 'grid' | 'list') => void;
  pickHero: (hero: string) => void;
  retry: () => void;
  openMod: (mod: Mod, card: HTMLElement) => void;
  favChanged: () => void;
  openCosmetic: (slot: string, id: string, card: HTMLElement) => void;
  cosmeticFavChanged: () => void;
  cosmeticFilter: (patch: { sort?: string; installedOnly?: boolean; favOnly?: boolean; search?: string }) => void;
  openHero: (hero: string, card: HTMLElement) => void;
  openArcana: (card: HTMLElement) => void;
}

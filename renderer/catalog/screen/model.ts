/* What the catalog screen shows, worked out by views/catalog/screens.ts and drawn by Screen.tsx. The
 * split keeps the rules (which mods, which chips, which heading) where the data is, and the
 * markup in one place per shape. */
import type { Filters, Mod } from '../types.ts';
import type { ArcanaCardModel } from '../arcana/ArcanaCard.tsx';
import type { MapLookCardModel } from '../map/MapLookCard.tsx';
import type { SoundCardModel } from '../sounds/SoundCard.tsx';
import type { BackgroundCardModel } from '../background/BackgroundCard.tsx';
import type { HudCardModel } from '../hud/HudCard.tsx';
import type { RankCardModel } from '../rank/RankCard.tsx';
import type { MapKind } from '../../api/content.ts';
import type { CosmeticItem } from '../cosmetic/CosmeticCard.tsx';

export interface ToolbarModel {
  resultCount: number;
  /** print the count only when the list is narrower than the category: "did that chip do anything" */
  showCount: boolean;
  sort: string;
  /** the authors of the mods on screen, with how many each, and the one picked ('' for all) */
  authors: { value: string; label: string }[];
  author: string;
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
  | { kind: 'home'; recent: Mod[]; /** how many there are in all, when more than the strip shows; else 0 */ recentTotal: number; tiles: { id: string; name: string; preview: string | null }[] }
  | {
    kind: 'list';
    /** a new key is a new screen, entrances and all; the same key updates the one on show */
    key: string;
    title: string;
    accent?: string;
    /** a way back: to the whole heroes category, or to the front page */
    back?: 'heroes' | 'home';
    toolbar: ToolbarModel | null;
    note?: string;
    /** a tool the app has in it, first in the grid (the arcana's, among the tools) */
    lead?: ArcanaCardModel[] | null;
    /** towers or trees out of the game's own looks, first in those two categories */
    mapLead?: MapLookCardModel | null;
    /** a sound of the user's own on a hero's event, first among the hero sounds */
    soundLead?: SoundCardModel | null;
    /** a main menu background of the user's own, first among the backgrounds */
    backgroundLead?: BackgroundCardModel | null;
    /** the in-game HUD smaller or larger, first among the HUDs */
    hudLead?: HudCardModel | null;
    rankLead?: RankCardModel | null;
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
  /** everything recently added, past the front page's strip */
  openRecent: () => void;
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
  openArcana: (set: string, card: HTMLElement) => void;
  openMapLooks: (kind: MapKind, card: HTMLElement) => void;
  openSounds: (card: HTMLElement) => void;
  openBackground: (card: HTMLElement) => void;
  openHud: (card: HTMLElement) => void;
  openRank: (card: HTMLElement) => void;
}

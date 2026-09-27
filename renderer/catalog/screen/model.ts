/* What the catalog screen shows, worked out by views/catalog.js and drawn by Screen.tsx. The
 * split keeps the rules (which mods, which chips, which heading) where the data is, and the
 * markup in one place per shape. */
import type { Filters, Mod } from '../types.ts';

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

export interface GridModel {
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
  | { kind: 'none' }
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
    mods: (GridModel & { heading: boolean }) | null;
    cosmetics: { html: string; more?: string } | null;
  }
  | { kind: 'heroes'; key: string; title: string; toolbar: ToolbarModel; tiles: HeroTileModel[] };

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
  bindCosmetics: (grid: HTMLElement) => void;
}

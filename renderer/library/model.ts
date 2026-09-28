/* What My mods shows, worked out by views/library/ and drawn by the components beside this file. */
import type { BulkOffer } from './selection.ts';
import type { RepairState } from './types.ts';

/** A pill after a row's name: what the file was recognised as, that it needs the schema, that it is covered. */
export interface Tag {
  /** the lib-tag variant: match, schema, schema off, covered, stale, dup, or '' */
  cls: string;
  text: string;
  icon?: string;
  title?: string;
}

/** A row's picture: a preview, a picture fetched by name when it scrolls near, or only a glyph. */
export type Thumb =
  | { url: string; video: boolean }
  | { key: string; icon: string | null }
  | { icon: string | null };

export interface RowModel {
  kind: 'mod';
  id: string;
  name: string;
  styleLabel: string | null;
  enabled: boolean;
  selected: boolean;
  /** a font has no switch, and nothing to tick */
  selectable: boolean;
  /** its place in the load order; null for a mod with no pak (no grip) */
  order: number | null;
  /** the entrance's stagger */
  index: number;
  /** moved in the order from its menu just now: it travels over its neighbour (row-motion.ts) */
  lift: boolean;
  thumb: Thumb;
  /** a cosmetic pick's picture, by its name, with its slot's glyph until then */
  cosmetic: { name: string; icon: string } | null;
  tags: Tag[];
  meta: string;
  pakFile: string | null;
  /** null: a font, "always on" instead of a switch */
  toggle: { title: string | null } | null;
  adoptable: boolean;
}

export interface MemberModel {
  key: string;
  id: string;
  name: string;
  styleLabel: string | null;
  enabled: boolean;
  selected: boolean;
  meta: string;
  thumb: Thumb;
}

export interface PackRowModel {
  kind: 'pack';
  id: string;
  name: string;
  enabled: boolean;
  selected: boolean;
  open: boolean;
  order: number | null;
  index: number;
  lift: boolean;
  /** the first members' pictures in a 2x2 grid, or one stand-in when not one of them has a picture */
  cells: ({ url: string; video: boolean } | { icon: string } | null)[] | null;
  standIn: Thumb;
  onCount: number;
  pakFile: string | null;
  members: MemberModel[];
}

export interface ExternalRowModel {
  key: string;
  name: string;
  enabled: boolean;
  dup: boolean;
  thumb: Thumb;
  tags: Tag[];
  fileName: string | null;
  size: string | null;
  sub: string;
  /** a cursor or font set is adopted whole, never switched or deleted here */
  simple: boolean;
  adopt: { title: string } | null;
  splittable: boolean;
}

/** What the banners over the list say, as data; Banners.tsx words it. */
export interface BannersModel {
  masterOff: boolean;
  /** installed and foreign files recognised as catalog mods, waiting to be linked */
  matched: number;
  nearLimit: { slots: number; ceil: number } | null;
  /** mods that change the same item in the schema */
  conflicts: { lists: string[][]; more: number } | null;
  /** another patcher's line in gameinfo */
  foreign: string | null;
  vanillaBad: boolean;
  /** the game mounts another language folder than ours */
  mounted: { mounted: string; folder: string } | null;
  /** mods left in a folder the game does not read */
  stranded: { suffix: string; modFiles: number }[];
  /** -language in Steam's launch options; followed when it names our folder */
  launchLang: { lang: string; followed: boolean } | null;
  /** Minify beside us (core/minify-notice.js), with the folders it and we build into */
  minify: { case: string; kind: string; folder: string; mounted: string; ourFolder: string; reservedLabel: string | null; ourMods: number } | null;
  prelaunch: boolean;
  /** fonts and cursors Steam put back, with no archive left to reinstall from */
  stuck: string[];
  repair: RepairState;
}

export interface LibraryModel {
  /** a new key draws the screen fresh, the rows' entrance and all */
  key: number;
  /** a new number lets the rows move to where this draw puts them (row-motion.ts) */
  motion: number;
  noticeHtml: string;
  banners: BannersModel;
  search: string;
  stats: string;
  /** the "select all" line over the mods, when there are mods to select */
  listHead: boolean;
  masterOff: boolean;
  empty: string | null;
  rows: (RowModel | PackRowModel)[];
  cosmetics: { rows: RowModel[]; count: number; on: number } | null;
  selectAll: { checked: boolean; indeterminate: boolean };
  selectAllCosmetics: { checked: boolean; indeterminate: boolean };
  external: { rows: ExternalRowModel[]; dupes: number } | null;
  bulk: BulkOffer;
}

export interface LibraryActions {
  search: (q: string) => void;
  select: (key: string, on: boolean) => void;
  selectAll: (on: boolean) => void;
  selectAllCosmetics: (on: boolean) => void;
  clearSelection: () => void;
  expand: (packId: string) => void;
  toggle: (id: string) => void;
  toggleMember: (packId: string, memberId: string) => Promise<void>;
  removeMember: (packId: string, memberId: string) => void;
  remove: (id: string) => void;
  adopt: (id: string) => Promise<void>;
  menu: (id: string) => { label?: string; icon?: string; separator?: boolean; disabled?: boolean; danger?: boolean; onPick?: () => void }[] | null;
  reorder: (id: string, to: number) => Promise<void>;
  banner: (id: string, data?: string) => Promise<void>;
  enableAll: (on: boolean) => void;
  disableCosmetics: () => void;
  importFiles: () => void;
  importFolder: () => void;
  bulk: (what: 'enable' | 'disable' | 'combine' | 'extract' | 'adopt' | 'remove') => void;
  external: (what: 'toggle' | 'adopt' | 'split' | 'remove', key: string) => Promise<void>;
  noticeRead: () => void;
}

import type { PreviewSlot } from '../../api/preview3d.ts';
/* What the item builder's hero window shows, worked out by views/item-hero.ts (the window),
 * views/item-builder.ts (a slot) and views/item-sets.ts (the sets), and drawn by the components
 * beside this file. One window, laid out as the game's own loadout: the hero on the left, its
 * slots down the middle, what one of them offers on the right. */
import type { SetFilters } from './set-filters.ts';
import type { EffectGroup } from './logic.ts';

/** The one button along a pane's bottom, and what it will put on. */
export interface BuilderAction {
  label: string;
  icon: string;
  off?: boolean;
  remove?: boolean;
}

/** What a card says of an item the game sells: its rarity key (for the colour), its name, and its year. */
interface Rarity {
  rarity: string;
  rarityName: string;
  year: string;
}

interface OptionCard extends Rarity {
  id: string;
  name: string;
  picked: boolean;
  on: boolean;
  /** what is known to go wrong with it in the game, or that nobody has checked (src/arcana-notes.ts) */
  note?: { status: 'issues' | 'broken' | 'untested'; text: string };
}

interface EffectCard {
  id: string;
  name: string;
  picture: string | null;
  picked: boolean;
}

/** The tabs over a slot's grid: its items, the chosen one's styles, effects on top, another item's effect. */
export type SlotView = 'items' | 'styles' | 'effects' | 'gems' | 'donors';

export interface SlotPaneModel {
  title: string;
  query: string;
  slotIcon: string;
  view: SlotView;
  gem?: { set: string; equipped: boolean };
  options: OptionCard[];
  /** how many items the slot offers, the search aside */
  optionsCount: number;
  /** the chosen item's styles; null when it has one look */
  styles: { index: number; name: string; picked: boolean }[] | null;
  /** null when the slot takes no effects; `count` all there are, the search aside */
  effects: { none: boolean; enabled: boolean; count: number; picked: number; groups: { group: EffectGroup; list: EffectCard[] }[] } | null;
  /** the slot's items with an effect of their own, to wear on the chosen one; null when none has one */
  donors: { none: boolean; list: { id: string; name: string; picked: boolean }[]; enabled: boolean; count: number } | null;
  summary: { name: string; effects: string };
  action: BuilderAction;
}

export interface SlotPaneActions {
  view: (v: SlotView) => void;
  search: (q: string) => void;
  choose: (id: string) => void;
  style: (index: number) => void;
  effect: (id: string) => void;
  donor: (id: string) => void;
  apply: () => void;
}

interface SetCard extends Rarity {
  id: string;
  name: string;
  on: boolean;
  meta: string;
}

export interface SetsPaneModel {
  count: number;
  query: string;
  sets: SetCard[];
  /** the toolbar (catalog/builder/set-filters.ts): what is chosen and what there is to choose from */
  filters: SetFilters;
  facets: { rarities: { value: string; label: string }[]; years: string[]; events: string[]; styled: boolean };
  active: number;
}

export interface SetsPaneActions {
  search: (q: string) => void;
  open: (id: string) => void;
  filter: (patch: Partial<SetFilters>) => void;
  reset: () => void;
}

interface PieceCard {
  index: number;
  name: string;
  fits: boolean;
  on: boolean;
  /** the piece's rarity as the game names it, and in the window's words; empty where it has none */
  rarity: string;
  rarityName: string;
  meta: string;
}

export interface SetPaneModel {
  name: string;
  count: string;
  pieces: PieceCard[];
  /** what the game says about the set; empty strings where it says nothing */
  facts: { rarity: string; rarityName: string; date: string; event: string; description: string };
  /** the looks the set comes in, null for one */
  styles: { index: number; name: string; picked: boolean }[] | null;
  action: BuilderAction;
}

export interface SetPaneActions {
  back: () => void;
  piece: (index: number) => void;
  style: (index: number) => void;
  apply: () => void;
}

/** A saved look (views/item-looks.ts): `pictures` the names of its items, `on` the hero wears it now. */
interface LookRow {
  id: string;
  name: string;
  pictures: string[];
  on: boolean;
}

interface SlotRow {
  slot: string;
  label: string;
  icon: string;
  /** the look on, whose picture and name the row shows; null for the hero's own item */
  liveName: string | null;
  /** how many items the slot offers */
  options: number;
}

/** The middle column: 'sets', 'looks' or a slot's id. */
export type HeroTab = string;

export type HeroPane =
  | { kind: 'slot'; m: SlotPaneModel; actions: SlotPaneActions }
  | { kind: 'sets'; m: SetsPaneModel; actions: SetsPaneActions }
  | { kind: 'set'; m: SetPaneModel; actions: SetPaneActions }
  | { kind: 'looks'; looks: LookRow[]; canSave: boolean };

export interface HeroModalModel {
  hero: string;
  /** the hero's portrait from hero selection, for the stage while the 3D view is off */
  portrait: string | null;
  /** its main attribute, for the colour under its name (src/item-builder-details.ts) */
  attr: string;
  tab: HeroTab;
  slots: SlotRow[];
  /** how many slots carry a pick */
  changed: number;
  /** a take-off, reset or look is on its way to the game */
  busy: boolean;
  /** the sets tab, null when the hero has none */
  sets: { count: number; on: string | null } | null;
  looks: number;
  /** the 3D preview (catalog/preview3d): the hero's name for its models, what each slot dresses, and
   * a key of what is on, so a pick draws it again; null hides the button */
  preview: { hero: string; slots: PreviewSlot[]; sig: string; open: boolean; gemSlots: Record<string, string> } | null;
  /** the hero's npc name for the recolour window (views/hero-paint.ts); null hides its button */
  paint: string | null;
  pane: HeroPane;
}

export interface HeroModalActions {
  close: () => void;
  tab: (tab: HeroTab) => void;
  togglePreview: () => void;
  openPaint: () => void;
  takeOff: (slot: string) => void;
  resetAll: () => void;
  saveLook: () => void;
  wearLook: (id: string) => void;
  renameLook: (id: string) => void;
  deleteLook: (id: string) => void;
}

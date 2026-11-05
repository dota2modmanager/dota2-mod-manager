/* What the item builder's windows show, worked out by views/item-builder.ts (which keeps what is
 * chosen, what is on and what the button does) and drawn by the components beside this file. */
import type { SetFilters } from './set-filters.ts';

/** The one button along a builder window's bottom, and what it will put on. */
export interface BuilderAction {
  label: string;
  icon: string;
  off?: boolean;
  remove?: boolean;
}

interface OptionCard {
  id: string;
  name: string;
  tags: string;
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

export interface SlotPickerModel {
  back: string | null;
  title: string;
  optionsCount: number;
  query: string;
  slotIcon: string;
  options: OptionCard[];
  /** the chosen item's styles; null when it has one look */
  styles: { index: number; name: string; picked: boolean }[] | null;
  /** null when the slot takes no effects */
  effects: {
    none: boolean; list: EffectCard[]; enabled: boolean; hint: string;
    /** the game's own unusual effects (src/item-builder-unusual.ts), as a row of buttons under the cards */
    game: { id: string; name: string; picked: boolean }[];
  } | null;
  /** the slot's items with an effect of their own, to wear on the chosen one; null when none has one */
  donors: { none: boolean; list: { id: string; name: string; picked: boolean }[]; enabled: boolean } | null;
  summary: { name: string; effects: string };
  action: BuilderAction;
}

export interface SlotPickerActions {
  back: () => void;
  close: () => void;
  search: (q: string) => void;
  choose: (id: string) => void;
  style: (index: number) => void;
  effect: (id: string) => void;
  donor: (id: string) => void;
  apply: () => void;
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

/** A saved look (views/item-looks.ts): `picture` the name of its first item, `on` the hero wears it now. */
interface LookRow {
  id: string;
  name: string;
  count: number;
  picture: string | null;
  on: boolean;
}

export interface HeroModalModel {
  hero: string;
  hub: string;
  slots: SlotRow[];
  /** how many slots carry a pick */
  changed: number;
  /** a take-off, reset or look is on its way to the game */
  busy: boolean;
  /** the sets button: the picture of the set on, else the first one's */
  sets: { name: string; count: number; on: boolean } | null;
  looks: LookRow[];
  /** the 3D preview (catalog/preview3d): the hero's name for its models, what each slot dresses, and
   * a key of what is on, so a pick draws it again; null hides the button */
  preview: { hero: string; slots: { slot: string; stock: string }[]; sig: string; open: boolean } | null;
  /** the hero's npc name for the recolour window (views/hero-paint.ts); null hides its button */
  paint: string | null;
}

export interface HeroModalActions {
  close: () => void;
  togglePreview: () => void;
  openPaint: () => void;
  openSets: () => void;
  openSlot: (slot: string) => void;
  takeOff: (slot: string) => void;
  resetAll: () => void;
  saveLook: () => void;
  wearLook: (id: string) => void;
  renameLook: (id: string) => void;
  deleteLook: (id: string) => void;
}

interface SetCard {
  id: string;
  name: string;
  on: boolean;
  meta: string;
  /** a rarity key, for its colour, and its name; '' when the game gives none */
  rarity: string;
  rarityName: string;
  /** the year it came out, '' when the game does not say */
  year: string;
}

export interface SetsModalModel {
  hero: string;
  count: number;
  query: string;
  sets: SetCard[];
  /** the toolbar (catalog/builder/set-filters.ts): what is chosen and what there is to choose from */
  filters: SetFilters;
  facets: { rarities: { value: string; label: string }[]; years: string[]; events: string[]; styled: boolean };
  active: number;
}

export interface SetsModalActions {
  back: () => void;
  close: () => void;
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
  meta: string;
}

export interface SetModalModel {
  name: string;
  hero: string;
  count: string;
  pieces: PieceCard[];
  /** what the game says about the set; empty strings where it says nothing */
  facts: { rarity: string; rarityName: string; date: string; event: string; description: string };
  /** the looks the set comes in, null for one */
  styles: { index: number; name: string; picked: boolean }[] | null;
  action: BuilderAction;
}

export interface SetModalActions {
  back: () => void;
  close: () => void;
  piece: (index: number) => void;
  style: (index: number) => void;
  apply: () => void;
}

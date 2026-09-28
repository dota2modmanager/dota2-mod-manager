/* What the item builder's windows show, worked out by views/item-builder.js (which keeps what is
 * chosen, what is on and what the button does) and drawn by the components beside this file. */

/** The one button along a builder window's bottom, and what it will put on. */
export interface BuilderAction {
  label: string;
  icon: string;
  off?: boolean;
  remove?: boolean;
}

export interface OptionCard {
  id: string;
  name: string;
  tags: string;
  picked: boolean;
  on: boolean;
}

export interface EffectCard {
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
  /** null when the slot takes no effects */
  effects: { none: boolean; list: EffectCard[]; enabled: boolean; hint: string } | null;
  summary: { name: string; effects: string };
  action: BuilderAction;
}

export interface SlotPickerActions {
  back: () => void;
  close: () => void;
  search: (q: string) => void;
  choose: (id: string) => void;
  effect: (id: string) => void;
  apply: () => void;
}

export interface SlotTile {
  slot: string;
  label: string;
  icon: string;
  /** the look on, whose picture the tile shows */
  liveName: string | null;
  meta: string;
}

export interface HeroModalModel {
  hero: string;
  hub: string;
  slots: SlotTile[];
  /** the sets tile: the picture of the set on, else the first one's */
  sets: { name: string; count: number; on: boolean } | null;
}

export interface HeroModalActions {
  close: () => void;
  openSets: () => void;
  openSlot: (slot: string) => void;
}

export interface SetCard {
  id: string;
  name: string;
  on: boolean;
  meta: string;
}

export interface SetsModalModel {
  hero: string;
  count: number;
  query: string;
  sets: SetCard[];
}

export interface SetsModalActions {
  back: () => void;
  close: () => void;
  search: (q: string) => void;
  open: (id: string) => void;
}

export interface PieceCard {
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
  action: BuilderAction;
}

export interface SetModalActions {
  back: () => void;
  close: () => void;
  piece: (index: number) => void;
  apply: () => void;
}

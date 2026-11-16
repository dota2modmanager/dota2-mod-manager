/* The own-cursor window's model and actions (CursorModal.tsx draws them, views/catalog/cursor.ts
 * keeps them). */
import type { CursorKind } from './kinds.ts';
import type { Source } from './design.ts';

/** A set of the game's to take a cursor from: its name and its picture of that cursor (or of its
 * default cursor, on the set's own card). */
export interface PackChoice { id: string; name: string; picture: string }

export interface CursorTile {
  kind: CursorKind;
  source: Source;
  /** what the chip on the tile says: the game, the set's name, own */
  from: string;
  /** the game's picture, and the one it will be (null: stays the game's) */
  game: string;
  mine: string | null;
  /** the hotspot as a share of the cursor, and a CSS cursor of it to try it on */
  hot: [number, number];
  css: string;
  /** the sets that have this cursor */
  options: PackChoice[];
}

export type PlayMode = 'move' | 'attack' | 'spell';

export interface CursorModalModel {
  tiles: CursorTile[];
  /** the game's sets, each with how many cursors it has */
  packs: (PackChoice & { count: number })[];
  /** the set every cursor comes from now, or null */
  whole: string | null;
  /** the game's own default cursor, for the card that puts every cursor back */
  gamePicture: string;
  selected: string | null;
  play: PlayMode;
  installed: boolean;
  /** nothing changed since the set on now */
  saved: boolean;
  busy: boolean;
}

export interface CursorModalActions {
  close: () => void;
  /** every cursor from one set, or with null every cursor the game's */
  pack: (id: string | null) => void;
  select: (name: string | null) => void;
  source: (name: string, s: Source) => void;
  own: (name: string, f: File) => void;
  hot: (name: string, at: [number, number]) => void;
  play: (p: PlayMode) => void;
  install: () => void;
}

/** The share of an element a pointer event fell at. */
export function shareAt(e: { clientX: number; clientY: number; currentTarget: Element }): [number, number] {
  const r = e.currentTarget.getBoundingClientRect();
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  return [c((e.clientX - r.left) / (r.width || 1)), c((e.clientY - r.top) / (r.height || 1))];
}

/** The first picture a drop carries. */
export function droppedPicture(e: { dataTransfer: DataTransfer | null }): File | null {
  return [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/')) ?? null;
}

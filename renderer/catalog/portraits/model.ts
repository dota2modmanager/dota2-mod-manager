/* What the window for hero picker portraits draws (PortraitStudio.tsx) and what it can ask for.
 * views/catalog/portraits.ts holds it and talks to the core. */
import type { PortraitTarget } from '../../api/portraits.ts';

/** A hero in the window's own picker: his picture from the game, and what of his own is on. */
export interface PortraitHero {
  hero: string;
  name: string;
  picture: string | null;
  /** the game's movie, once it was asked for (pointing at the hero asks) */
  movie: string | null;
  own: { still: boolean; movie: boolean } | null;
}

/** The hero brought up close: the game's and the user's picture and movie side by side. */
export interface PortraitDetail {
  hero: string;
  name: string;
  targets: PortraitTarget[];
  gamePicture: string | null;
  gameMovie: string | null;
  /** the picture and movie he will have: the user's (on now or just picked), or null for the game's */
  ownPicture: string | null;
  ownMovie: string | null;
  /** picked here and not put on yet */
  fresh: { still: boolean; movie: boolean };
  /** something here differs from what is on now */
  dirty: boolean;
  /** on now, as a mod */
  installed: boolean;
}

export interface PortraitStudioModel {
  heroes: PortraitHero[];
  filter: string;
  open: PortraitDetail | null;
  /** which look the hero up close shows: the game's, or the one he will have */
  view: 'game' | 'mine';
  /** a movie being encoded: 0 to 1; building: 1 */
  busy: number | null;
}

export interface PortraitStudioActions {
  close: () => void;
  filter: (text: string) => void;
  pick: (hero: string) => void;
  /** the pointer came onto a hero in the picker: his game movie, if not here yet */
  hover: (hero: string) => void;
  back: () => void;
  view: (v: 'game' | 'mine') => void;
  still: (f: File) => void;
  movie: (f: File) => void;
  /** a part of the user's taken back to the game's */
  drop: (part: 'still' | 'movie') => void;
  install: () => void;
}

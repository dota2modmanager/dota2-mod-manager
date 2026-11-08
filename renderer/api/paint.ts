/* The recolour window's channels (src/ipc-paint.ts, src/hero-paint-service.ts). */
import type { LibRecord } from '../library/types.ts';
import type { Reply } from './reply.ts';

/** One part of a hero that takes a colour of its own (src/recolor-layers.ts). */
export interface PaintLayer {
  id: string; kind: 'ability' | 'abilityIcon' | 'effects' | 'portrait' | 'body' | 'item' | 'itemModel'; name: string | null; files: number;
  /** an effect layer's particles, compiled paths: the 3D preview tints those it plays */
  particles?: string[];
  /** an item's colour layer: the other items' that share a texture with it, and so a colour */
  shares?: string[];
}

/** A hero recoloured part by part (src/hero-paint-service.ts). */
export interface PaintApi {
  /** the hero's layers, and the colour of each on now */
  state: (hero: string, items?: string[]) => Promise<Reply<{ layers: PaintLayer[]; installed: { id: string; layers: Record<string, string>; enabled: boolean } | null; vrf: boolean }>>;
  /**
   * the hero in a '#rrggbb' or '#rrggbb:mode' per layer that is on, put in My mods in place of the one before
   * @param items the items the hero wears, stock ones too, whose own colours the window offers
   */
  install: (hero: string, colors: Record<string, string>, label: string, items?: string[]) => Promise<Reply<{ record: LibRecord }>>;
  /** the abilities' icons out of the game, by ability name; the ones it could not read are left out */
  icons: (abilities: string[]) => Promise<Record<string, string>>;
}

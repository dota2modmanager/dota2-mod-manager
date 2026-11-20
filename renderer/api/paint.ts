/* The recolour window's channels (crates/mm-core/src/owner/owner_tools.rs, crates/mm-core/src/looks/hero_paint_service.rs). */
import type { LibRecord } from '../library/types.ts';
import type { Reply } from './reply.ts';

/** One part of a hero that takes a colour of its own (crates/mm-core/src/looks/recolor_layers.rs). */
export interface PaintLayer {
  id: string; kind: 'ability' | 'abilityIcon' | 'effects' | 'portrait' | 'body' | 'item' | 'itemModel'; name: string | null; files: number;
  /** an effect layer's particles, compiled paths: the 3D preview tints those it plays */
  particles?: string[];
  /** an item's colour layer: the other items' that share a texture with it, and so a colour */
  shares?: string[];
  /** a model layer (body, an item's colour): its colour textures, each a part of the model to paint on its own */
  parts?: PaintPart[];
}

/** One part of a model: the meshes drawn from one colour texture (crates/mm-core/src/looks/hero_paint_parts.rs). */
export interface PaintPart {
  /** its key in a layer's value, `body@<id>` */
  id: string;
  /** the colour texture, compiled path */
  file: string;
  /** the materials drawn from it (materials/….vmat), for the 3D preview to paint */
  materials: string[];
  /** whether those have masks: only then can its material change */
  masks: boolean;
}

/** A part's texture as a small picture, and the colour zones in it: [zone, share 0-1, its mean colour]. */
export interface PaintPartPicture { picture: string; zones: [string, number, string][] }

/** A hero recoloured part by part (crates/mm-core/src/looks/hero_paint_service.rs). */
export interface PaintApi {
  /** the hero's layers, and the colour of each on now */
  state: (hero: string, items?: string[]) => Promise<Reply<{ layers: PaintLayer[]; installed: { id: string; layers: Record<string, string>; enabled: boolean } | null; vrf: boolean }>>;
  /**
   * the hero in a value per key that is on (catalog/paint/paint-recipe.ts: a layer, a part, a zone; a colour and a material), put in My mods in place of the one before
   * @param items the items the hero wears, stock ones too, whose own colours the window offers
   */
  install: (hero: string, colors: Record<string, string>, label: string, items?: string[]) => Promise<Reply<{ record: LibRecord }>>;
  /** the model's colour textures as small pictures with their colour zones, by file; one it could not read is left out */
  parts: (files: string[]) => Promise<Record<string, PaintPartPicture>>;
  /** the abilities' icons out of the game, by ability name; the ones it could not read are left out */
  icons: (abilities: string[]) => Promise<Record<string, string>>;
}

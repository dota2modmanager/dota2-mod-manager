/**
 * What src/recolor.ts can recolour: each item's particle and material folders, the colour of the
 * gem it comes with, and whether that colour is baked in (an item with no gem of its own).
 */
/** A colour as three whole numbers 0-255. */
export type Rgb = [number, number, number];

/** What can be recoloured, by path prefix in pak01, and the colour of the gem the item comes with. */
export interface RecolorSet {
  name: string;
  gem: Rgb;
  /** particles only this item uses: colours written in them follow the chosen one */
  own: string[];
  /** particles it shares with the hero and his other items: only the gem's tint changes */
  shared: string[];
  /** materials that read the gem's colour */
  materials: string[];
  /**
   * Of the shared particles, the hero's own abilities, whose written colours the built mod moves
   * as well: Valve's Terrorblade arcana tints Sunder with the gem but not Terror Wave (Aghanim's)
   * nor Demon Zeal (the shard), which stayed blue with the arcana in any colour. The 3D preview
   * keeps them shared and colours them its own way (renderer/catalog/preview3d/loadout-gems.ts).
   */
  abilities?: string[];
  /**
   * The item comes with no gem, so the game turns its tint off and draws the colours written in
   * the particles: those are written in the chosen colour (bake). `gem` is then the colour its
   * effects are drawn in, for the picture and the "as in the game" choice.
   */
  // the tint is left as it is: a prismatic gem set in the item shows its own colour
  bake?: boolean;
}

export const RECOLOR_SETS: Record<string, RecolorSet> = {
  'terrorblade-arcana': {
    name: 'Fractal Horns of Inner Abysm',
    // items_game, colors: unusual_terrorblade_abysm, "Reflection's Shade"
    gem: [255, 60, 40],
    own: ['particles/econ/items/terrorblade/terrorblade_horns_arcana/'],
    shared: ['particles/units/heroes/hero_terrorblade/', 'particles/models/heroes/terrorblade/', 'particles/econ/items/terrorblade/'],
    abilities: ['particles/units/heroes/hero_terrorblade/', 'particles/models/heroes/terrorblade/'],
    materials: ['materials/models/heroes/terrorblade/', 'materials/models/items/terrorblade/'],
  },
  'techies-arcana': {
    name: 'Swine of the Sunken Galley',
    // items_game, colors: unusual_techies_swine, the arcana's own gold (issue #392)
    gem: [255, 175, 0],
    own: ['particles/econ/items/techies/techies_arcana/'],
    shared: ['particles/units/heroes/hero_techies/'],
    // no material of the cart reads $GemColor (counted 2026-11-03): its wood and iron keep their colour
    materials: ['materials/models/items/techies/bigshot/'],
  },
  /* Immortals whose particles read the gem's colour, the most of any item outside the arcanas
     (issue #392, counted in pak01 2026-11-04). They come with no gem, so the colour is baked in;
     `gem` is the commonest colour written in their particles. */
  'terrorblade-span': {
    name: 'Span of Sorrow',
    gem: [64, 192, 255],
    own: ['particles/econ/items/terrorblade/terrorblade_back_ti8/'],
    shared: [],
    materials: [],
    bake: true,
  },
  'terrorblade-scythes': {
    name: 'Scythes of Sorrow',
    gem: [160, 224, 255],
    own: ['particles/econ/items/terrorblade/terrorblade_ti9_immortal/'],
    shared: [],
    materials: [],
    bake: true,
  },
  'razor-crest': {
    name: 'Severing Crest',
    gem: [192, 192, 255],
    own: ['particles/econ/items/razor/razor_punctured_crest/'],
    shared: [],
    materials: [],
    bake: true,
  },
};

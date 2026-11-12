/**
 * The arcanas the app can build (src/arcana.ts): for each, the models it puts under the hero's own
 * names, its pictures, the particle that hosts its own, and the particles it swaps. Every entry is
 * read off the item's visuals in items_game by `npm run item-plan` and checked in the game
 * (docs/item-mods.md). Moved out of src/arcana.ts, which keeps how a set is built.
 */

export interface ArcanaSet {
  /** the recolour set with the arcana's particles and materials */
  recolor: string;
  /** models to put under another name: game path -> the model in pak01, and the activity modifier
   *  the item turns on for it, whose animations are to play without it */
  models: Record<string, { from: string; modifier?: string }>;
  /** images whose name with this removed is the plain one (`_alt1`) */
  images: { under: string[]; mark: string; hero: string };
  /** a particle the hero creates, the arcana's version of it, and the arcana's own particles to hang on it;
   *  `bind`: the host hands no points to its children, so each child's point is bound for it (withChildAt) */
  host: { at: string; from: string; children: Child[]; bind?: boolean };
  /** another item's particle the arcana swaps for one of its own while both are worn (its visuals
   *  in items_game): game path -> the arcana's version in pak01 */
  swaps?: Record<string, string>;
  /** a particle an item of the hero's form creates in the loadout only, hung on one the game creates
   *  in that form (at), on the form's attachment, while the item is picked in the builder */
  forms?: { item: string; at: string; child: string; attachment: string }[];
}

/** A particle to hang on another, and the model attachment it is drawn at (none: its parent's first point). */
export interface Child { path: string; attachment?: string }

const TB = 'particles/units/heroes/hero_terrorblade';
const ARCANA = 'particles/econ/items/terrorblade/terrorblade_horns_arcana';
const DREADHUNT = 'particles/econ/items/terrorblade/dreadhunt';
const TECHIES = 'particles/units/heroes/hero_techies';
const SWINE = 'particles/econ/items/techies/techies_arcana';

export const ARCANA_SETS: Record<string, ArcanaSet> = {
  'terrorblade-arcana': {
    recolor: 'terrorblade-arcana',
    models: {
      'models/heroes/terrorblade/terrorblade.vmdl_c': { from: 'models/heroes/terrorblade/terrorblade_arcana.vmdl_c', modifier: 'abysm' },
      'models/heroes/terrorblade/horns.vmdl_c': { from: 'models/heroes/terrorblade/horns_arcana.vmdl_c' },
    },
    images: { under: ['panorama/images/heroes/', 'panorama/images/spellicons/'], mark: '_alt1', hero: 'terrorblade' },
    host: {
      at: `${TB}/terrorblade_ambient_eyes.vpcf_c`,
      from: `${ARCANA}/terrorblade_ambient_eyes_arcana_horns.vpcf_c`,
      // its own preview puts it on the horns' attach_hitloc, the chest
      children: [{ path: `${ARCANA}/terrorblade_ambient_body_arcana_horns.vpcf`, attachment: 'attach_hitloc' }],
    },
    // Rictus Ripper's head (31411) creates an eye with nothing in it; worn with the arcana, the
    // eye is the arcana's, whose glow takes the gem's colour (Fractal Horns' visuals, 2026-10-19)
    swaps: { [`${DREADHUNT}/dreadhunt_head_ambient.vpcf_c`]: `${DREADHUNT}/dreadhunt_arcana_head_ambient.vpcf_c` },
    // Rictus Ripper's demon (31410) has its eye spawn_in_loadout_only: in a match the demon had none.
    // The game creates the metamorphosis on the demon, so the eye goes on it, at the demon's eye
    forms: [{ item: '31410', at: `${TB}/terrorblade_metamorphosis.vpcf_c`, child: `${DREADHUNT}/dreadhunt_demon_ambient.vpcf`, attachment: 'attach_eye' }],
  },
  // Swine of the Sunken Galley (6879), a cart: issue #392. Its visuals in items_game, by hand
  'techies-arcana': {
    recolor: 'techies-arcana',
    models: {
      // the arcana's animations live in the hero's own model behind the item's activity modifier
      'models/heroes/techies/techies.vmdl_c': { from: 'models/heroes/techies/techies.vmdl_c', modifier: 'techies_arcana' },
      'models/heroes/techies/techies_cart.vmdl_c': { from: 'models/items/techies/bigshot/bigshot.vmdl_c', modifier: 'techies_arcana' },
    },
    images: { under: ['panorama/images/heroes/'], mark: '_alt1', hero: 'techies' },
    host: {
      // the default cart (490) creates the ambient; the arcana's ambient goes under its name
      at: `${TECHIES}/techies_ambient.vpcf_c`,
      from: `${SWINE}/techies_ambient_arcana.vpcf_c`,
      // the fuse in the pig's hand, where its own preview puts it
      children: [{ path: `${SWINE}/techies_bigshot_fuse.vpcf`, attachment: 'attach_fxhand' }],
      // the ambient's five children all sit on its one point; the fuse needs one of its own
      bind: true,
    },
    // the hero's own particles the item swaps (asset_modifier1, 5 and 8)
    swaps: {
      [`${TECHIES}/techies_base_attack.vpcf_c`]: `${SWINE}/techies_base_attack_arcana.vpcf_c`,
      [`${TECHIES}/techies_loadout.vpcf_c`]: `${SWINE}/techies_loadout_arcana.vpcf_c`,
      [`${TECHIES}/techies_suicide.vpcf_c`]: `${SWINE}/techies_suicide_arcana.vpcf_c`,
    },
  },
};

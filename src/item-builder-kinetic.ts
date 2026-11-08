/* Kinetic gems on any item: the game's animation gems (Fishstick, Rampant, Twister), which an owned
 * item carries in a socket the Game Coordinator sends and a mod cannot change. The table's
 * "asset_modifiers" section says what each does: an activity (or ALL) and the modifier the hero's
 * animations for it are marked with.
 *
 * A gem rides in the pick's effect string as `kinetic-<name>`, beside the effects (src/item-builder.ts
 * effectKey). It goes in twice, as an arcana's animations do. In the table, which hero demo reads. And
 * in the hero's model under its own path with the modifier taken off (arcana.ts asModel), because
 * online the server sets the modifiers from its own table, where the stock item has none. One hero
 * model goes in however many gems the hero wears, so the build gathers them (kineticEntries). A hero
 * whose model is swapped by an arcana keeps that body: it goes in over the gems' (`beneath`).
 */
import { blockBounds, eachChild } from './schema-kv.ts';
import { gameAssetEntries } from './item-builder-assets.ts';
import { withModifiers } from './item-builder-donor.ts';
import type { VpkEntry } from './vpk.ts';

/** A gem's token in a pick's effect string, with its name in the table. */
export const KINETIC = /^kinetic-([\w-]+)$/;

/** One gem of the table: its `name`, the token of the name the game shows, and [activity, modifier] pairs. */
export interface KineticGem { name: string; token: string; activities: [string, string][] }

/**
 * The heroes whose models hold each gem's animations, found by reading every hero's model
 * (2026-11-08): the table does not say whose a gem is. A patch's new gem stays off the shelf until
 * it is listed here.
 */
const GEM_HEROES: Record<string, string[]> = {
  silent_ripper: ['slark'], pyre: ['doom_bringer'], eyeoffetizu: ['doom_bringer'], odachi: ['juggernaut'], bladebiter: ['kunkka'],
  deadwinter_soul: ['lich'], death_protest: ['necrolyte'], dizzying_punch: ['tusk'], wraith_spin: ['skeleton_king'],
  serene_honor: ['phantom_lancer'], red_moon: ['lycan'], turbulent_teleport: ['furion'], dagger_twirl: ['queenofpain'],
  impatient_maiden: ['crystal_maiden'], obeisance_of_the_keeper: ['keeper_of_the_light'], when_nature_attacks: ['furion'], twister: ['lina'],
  salvaged_sword: ['skeleton_king'], triumphant_timelord: ['faceless_void'], ss_fortune: ['storm_spirit'], es_prosperity: ['ember_spirit'],
  swordonshoulder: ['dragon_knight'], lucentyr: ['luna'], f2p_doom: ['doom_bringer'], fear: ['sven', 'rubick'], bot: ['tinker'],
  ftp_dendi_back: ['pudge'], telebolt: ['rattletrap'], glory: ['warlock'], mgc: ['sniper'], moth: ['death_prophet'], windy: ['windrunner'],
  iron: ['dragon_knight'], everlasting_array: ['lina'], fishstick: ['lion'], glacier: ['crystal_maiden'], rampant: ['axe'], lodestar: ['enchantress'],
  emp: ['invoker', 'skywrath_mage'], burning_fiend: ['doom_bringer'], harlequin: ['rubick'], dc_centaur_double_edge: ['centaur'],
  moon_griffon: ['mirana'], trapper: ['pudge'],
};

let cache: { text: string; gems: Map<string, KineticGem> } | null = null;

/** Every gem in the table, by its name in lower case. */
export function kineticGems(text: string): Map<string, KineticGem> {
  if (cache?.text === text) return cache.gems;
  const gems = new Map<string, KineticGem>();
  const at = /\n\t"asset_modifiers"\s*\n/.exec(text);
  if (at) {
    eachChild(text, blockBounds(text, at.index + at[0].length - 1), (entry) => {
      if (!entry.isBlock) return;
      const gem: KineticGem = { name: '', token: '', activities: [] };
      eachChild(text, entry.body, (f) => {
        if (!f.isBlock && f.key === 'name') gem.name = f.value;
        else if (!f.isBlock && f.key === 'loc_key') gem.token = f.value;
        else if (f.isBlock) {
          const mod = new Map<string, string>();
          eachChild(text, f.body, (x) => { if (!x.isBlock) mod.set(x.key.toLowerCase(), x.value); });
          if (mod.get('type')?.toLowerCase() === 'activity' && mod.get('modifier')) gem.activities.push([mod.get('asset') || 'ALL', mod.get('modifier')!]);
        }
      });
      if (gem.name && gem.activities.length) gems.set(gem.name.toLowerCase(), gem);
    });
  }
  cache = { text, gems };
  return gems;
}

/** The gems a hero's model can play, as the picker offers them. @param heroes  npc_dota_hero_* */
export function offeredKinetic(text: string, heroes: string[]): { id: string; nameToken: string; fallback: string }[] {
  const short = new Set(heroes.map((h) => h.replace(/^npc_dota_hero_/, '')));
  return [...kineticGems(text).entries()]
    .filter(([name]) => GEM_HEROES[name]?.some((h) => short.has(h)))
    .map(([name, gem]) => ({ id: `kinetic-${name}`, nameToken: gem.token, fallback: name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) }));
}

/** The gems among a pick's effects. @throws when the table has no such gem, as an unknown effect does */
export function picksGems(text: string, effectKey: string): KineticGem[] {
  return effectKey.split(',').filter((id) => KINETIC.test(id)).map((id) => {
    const gem = kineticGems(text).get(KINETIC.exec(id)![1]);
    if (!gem) throw new Error(`items_game: ${id}`);
    return gem;
  });
}

/** The visuals wearing these gems' activity modifiers, for hero demo. */
export function withKinetics(visuals: string, gems: KineticGem[]): string {
  return withModifiers(visuals, gems.flatMap((g) => g.activities.map(([asset, modifier]) => `"asset_modifier"\r\n{\r\n\t"type"\t\t"activity"\r\n\t"asset"\t\t"${asset}"\r\n\t"modifier"\t\t"${modifier}"\r\n}`)));
}

/** Each hero's model with the modifiers of all the gems the hero wears taken off. @param worn  hero -> modifiers */
export function kineticEntries(game: string, worn: Map<string, Set<string>>): VpkEntry[] {
  return gameAssetEntries(game, [...worn].map(([hero, modifiers]) => ({ from: '', hero, activities: [...modifiers] })));
}

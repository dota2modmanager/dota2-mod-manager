/* Which hero a name means, in the three spellings this app meets: the game's folder id
 * (queenofpain), what an author typed (queen_of_pain, qop), and what people read ("Queen of
 * Pain"). Out of src/vpk.ts, where it began, because the catalog asks too and vpk.ts is at its
 * size budget.
 */

// Dota's internal hero folder names differ from the display name for a chunk of the
// roster. Only the mismatches are listed; anything else is title-cased from its id.
export const HERO_DISPLAY: Readonly<Record<string, string>> = {
  nerubian_assassin: 'Nyx Assassin', obsidian_destroyer: 'Outworld Destroyer',
  skeleton_king: 'Wraith King', windrunner: 'Windranger', shredder: 'Timbersaw',
  rattletrap: 'Clockwerk', furion: "Nature's Prophet", doom_bringer: 'Doom',
  wisp: 'Io', zuus: 'Zeus', necrolyte: 'Necrophos', magnataur: 'Magnus',
  treant: 'Treant Protector', abyssal_underlord: 'Underlord', life_stealer: 'Lifestealer',
  centaur: 'Centaur Warrunner', vengefulspirit: 'Vengeful Spirit', queenofpain: 'Queen of Pain',
  nevermore: 'Shadow Fiend', drow_ranger: 'Drow Ranger', keeper_of_the_light: 'Keeper of the Light',
  dark_seer: 'Dark Seer', night_stalker: 'Night Stalker', bounty_hunter: 'Bounty Hunter',
  storm_spirit: 'Storm Spirit', earth_spirit: 'Earth Spirit', ember_spirit: 'Ember Spirit',
  spirit_breaker: 'Spirit Breaker', faceless_void: 'Faceless Void', phantom_assassin: 'Phantom Assassin',
  phantom_lancer: 'Phantom Lancer', shadow_demon: 'Shadow Demon', shadow_shaman: 'Shadow Shaman',
  witch_doctor: 'Witch Doctor', crystal_maiden: 'Crystal Maiden', dragon_knight: 'Dragon Knight',
  legion_commander: 'Legion Commander', ancient_apparition: 'Ancient Apparition',
  // the game's own folder is "antimage"; "anti_mage" is how people write it
  antimage: 'Anti-Mage', anti_mage: 'Anti-Mage',
  sand_king: 'Sand King', death_prophet: 'Death Prophet', troll_warlord: 'Troll Warlord',
  templar_assassin: 'Templar Assassin', naga_siren: 'Naga Siren', ogre_magi: 'Ogre Magi',
  elder_titan: 'Elder Titan', arc_warden: 'Arc Warden', winter_wyvern: 'Winter Wyvern',
  primal_beast: 'Primal Beast', void_spirit: 'Void Spirit',
};

// Short and misspelled folder names authors use for a hero whose canonical id looks
// nothing like the name. Anything that differs only in spacing or punctuation
// (crystalmaiden / crystal_maiden, queenofpain / queen_of_pain) needs no entry — heroKey
// below folds those together on its own.
export const HERO_ALIAS: Readonly<Record<string, string>> = {
  nyx: 'nerubian_assassin', nyx_assassin: 'nerubian_assassin', nyx_assasin: 'nerubian_assassin',
  outworld_destroyer: 'obsidian_destroyer', outworld_devourer: 'obsidian_destroyer',
  wraith_king: 'skeleton_king', windranger: 'windrunner', timbersaw: 'shredder',
  clockwerk: 'rattletrap', natures_prophet: 'furion', nature_prophet: 'furion',
  doom: 'doom_bringer', io: 'wisp', zeus: 'zuus', necrophos: 'necrolyte', magnus: 'magnataur',
  treant_protector: 'treant', underlord: 'abyssal_underlord', lifestealer: 'life_stealer',
  centaur_warrunner: 'centaur', vengeful_spirit: 'vengefulspirit', shadow_fiend: 'nevermore',
  // Merges by key already, but has no display name of its own, so a mod that uses only this
  // spelling announced itself as "Shadowshaman".
  shadowshaman: 'shadow_shaman',
  // A persona is the same hero in another body, and the game files it under a folder of its
  // own: models/heroes/antimage_female is Anti-Mage's Wei, models/heroes/invoker_kid is
  // Invoker's Acolyte. Without these a pack that dresses one hero looks like a pack that
  // dresses two — it comes in named "Antimage, Antimage Female", and an import of two to
  // four heroes splits itself, so a single Anti-Mage skin arrived as two half mods.
  antimage_female: 'antimage', invoker_kid: 'invoker', pudge_cute: 'pudge',
  crystal_maiden_persona: 'crystal_maiden', mirana_persona: 'mirana',
  phantom_assassin_persona: 'phantom_assassin', dragon_knight_persona: 'dragon_knight',
  // Folder names the game kept from before the hero was renamed, or shortened by hand.
  drow: 'drow_ranger', gyro: 'gyrocopter', blood_seeker: 'bloodseeker', lanaya: 'templar_assassin',
  tuskarr: 'tusk', vengeful: 'vengefulspirit', rikimaru: 'riki', siren: 'naga_siren',
  bard: 'largo', sandking: 'sand_king',
};

/** What people call a hero the game or an author files as `id` (skeleton_king -> Wraith King). */
export function heroDisplayName(id: string): string {
  const canon = HERO_ALIAS[id] || id;
  if (HERO_DISPLAY[canon]) return HERO_DISPLAY[canon];
  return canon.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// A catalog names a hero the way people do ("Queen of Pain", "Nature's Prophet"); the game
// files it under an id that can look nothing like that (queenofpain, furion). Display names
// are matched first, punctuation ignored, and whatever is not among them is taken as a folder
// name somebody typed.
const HERO_ID_BY_NAME = new Map<string, string>();
for (const [id, name] of Object.entries(HERO_DISPLAY)) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  // first listed wins: antimage, the game's own folder, before anti_mage, the common spelling
  if (!HERO_ID_BY_NAME.has(key)) HERO_ID_BY_NAME.set(key, id);
}

/** The game's id for a hero the catalog names ("Queen of Pain" -> queenofpain), or null. */
export function heroIdFromName(name: unknown): string | null {
  const text = String(name || '').toLowerCase();
  const byName = HERO_ID_BY_NAME.get(text.replace(/[^a-z0-9]/g, ''));
  if (byName) return byName;
  const slug = text.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return HERO_ALIAS[slug] || slug || null;
}

// Identity of a hero regardless of how the author spelled the folder. Authors mix
// "crystal_maiden", "crystalmaiden" and "CrystalMaiden" inside one pack, and each spelling
// used to count as a separate hero — which turned a single-hero skin into a "bundle of 3"
// and offered to split it into parts that make no sense.
export function heroKey(id: string): string {
  return heroDisplayName(id).toLowerCase().replace(/[^a-z0-9]/g, '');
}

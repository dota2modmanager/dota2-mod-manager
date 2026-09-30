// What a mod changes, read from the paths inside it: which heroes, which equip slots, or which
// kind of content, and a name for it. Part of the VPK code src/vpk.ts gathers.
import { t } from './i18n.ts';
import { HERO_DISPLAY, HERO_ALIAS, heroDisplayName, heroKey } from './hero-names.ts';
import { listVpkPaths } from './vpk-read.ts';

/** A hero a mod touches: the equip slots it replaces, whether it swaps the base model, how many models it carries. */
export interface HeroHit { id: string; name: string; slots: string[]; base: boolean; models: number }

/** What a mod's paths say it changes; see analyzeVpkPaths. */
export interface Analysis { heroes: HeroHit[]; kind: string; pathCount: number }

// keyword found in a model filename token -> canonical equip slot
const SLOT_KEYWORDS: [string, string][] = [
  ['shoulder', 'shoulder'], ['pauldron', 'shoulder'],
  ['helmet', 'head'], ['helm', 'head'], ['head', 'head'], ['hood', 'head'], ['mask', 'head'],
  ['hair', 'head'], ['face', 'head'], ['hat', 'head'], ['crown', 'head'], ['horn', 'head'],
  ['weapon', 'weapon'], ['sword', 'weapon'], ['blade', 'weapon'], ['staff', 'weapon'],
  ['bow', 'weapon'], ['axe', 'weapon'], ['hammer', 'weapon'], ['scythe', 'weapon'],
  ['offhand', 'offhand'], ['shield', 'shield'],
  ['bracer', 'arms'], ['glove', 'arms'], ['hand', 'arms'], ['arm', 'arms'],
  ['shoulders', 'shoulder'], ['belt', 'belt'], ['waist', 'belt'],
  ['cape', 'back'], ['cloak', 'back'], ['back', 'back'], ['wing', 'wings'], ['tail', 'tail'],
  ['skirt', 'legs'], ['leg', 'legs'], ['boot', 'legs'], ['feet', 'legs'], ['foot', 'legs'],
  ['mount', 'mount'], ['armor', 'armor'], ['ambient', 'ambient'],
];
const SLOT_DISPLAY: Record<string, string> = {
  head: 'голова', weapon: 'оружие', offhand: 'оружие (2)', shield: 'щит', armor: 'броня',
  shoulder: 'плечи', belt: 'пояс', arms: 'руки', back: 'спина', wings: 'крылья', tail: 'хвост',
  legs: 'ноги', mount: 'ездовое', ambient: 'эффекты', misc: 'разное', base: 'модель',
};

/** An equip slot as the user reads it, in their language. */
export function slotDisplayName(slot: string): string { return t(SLOT_DISPLAY[slot] || slot); }

function slotFromModelStem(hero: string, stem: string): string {
  if (stem === hero || /^\d+$/.test(stem)) return 'base'; // bare hero name or "1.vmdl" = base body override
  let tok = stem.startsWith(hero + '_') ? stem.slice(hero.length + 1) : stem;
  tok = tok.replace(/_(lod\d+|c|model|hero|full|default|\d+)$/g, '');
  if (!tok || /^\d+$/.test(tok) || /(^|_)(base|body|model)$/.test(tok)) return 'base';
  // the last token is what the piece IS ("transmuted_armaments_back" is a back item);
  // matching the whole string first made every set item an "arm" because "armaments"
  // happens to contain "arm"
  for (const part of [tok.split('_').pop() ?? '', tok]) {
    for (const [kw, slot] of SLOT_KEYWORDS) if (part.includes(kw)) return slot;
  }
  return 'misc';
}

const HERO_MODEL_RE = /^models\/heroes\/([a-z0-9_]+)\/(.+)$/;
const HERO_PARTICLE_RE = /^particles\/units\/heroes\/hero_([a-z0-9_]+)\//;
// Valve files every cosmetic item under the hero it belongs to, and every hero material
// under materials/models/heroes. A set mod - by far the most common thing people install -
// touches only these, and none of them used to be read at all: an arcana or a courier set
// came out with no hero, no name and no picture, which is what left a row saying nothing
// but "pak90_dir.vpk". The item roots also carry things that are not heroes (consumables,
// couriers, wards...), so the folder is only taken as a hero when it is not one of those.
const ITEM_MODEL_RE = /^models\/items\/([a-z0-9_]+)\/(.+)$/;
const ITEM_MATERIAL_RE = /^materials\/models\/(?:heroes|items)\/([a-z0-9_]+)\//;
const ECON_PARTICLE_RE = /^particles\/econ\/items\/([a-z0-9_]+)\//;
// Dota 2 Skinchanger writes its own content root named after the cart: "8213/heroes/<hero>/"
// and "8213/particles/<hero>/". Those two are as canonical as Valve's own layout, unlike the
// free-form folders authors put under materials/ — so they count, and only under a numeric
// root, where the name after it can only be a hero.
const CART_MODEL_RE = /^\d{3,}\/heroes\/([a-z0-9_]+)\/(.+)$/;
const CART_PARTICLE_RE = /^\d{3,}\/particles\/([a-z0-9_]+)\//;
// folder names that sit where a hero name would but are not one
const NON_HERO_FOLDER = new Set([
  'misc', 'common', 'shared', 'econ', 'items', 'generic', 'ui', 'props',
  'weather', 'ambient', 'effects', 'base', 'default', 'error', 'test',
  // things Valve also files under models/items and particles/econ/items
  'consumables', 'consumable', 'courier', 'couriers', 'ward', 'wards',
  'creeps', 'creep', 'towers', 'tower', 'neutral', 'neutrals', 'roshan',
  'pedestal', 'pedestals', 'taunts', 'taunt', 'emblems', 'emblem', 'sprays',
  'loadingscreens', 'loadingscreen', 'announcer', 'music', 'hud', 'terrain',
  'chests', 'chest', 'bundles', 'bundle', 'tools', 'dev', 'nomodel',
]);

/**
 * Classify what a mod's inner path list actually changes.
 * @param paths lowercased inner VPK paths (from listVpkPaths)
 */
export function analyzeVpkPaths(paths: string[]): Analysis {
  const heroes = new Map<string, { slots: Set<string>; base: boolean; models: number }>();
  const hero = (id: string) => {
    let h = heroes.get(id);
    if (!h) { h = { slots: new Set<string>(), base: false, models: 0 }; heroes.set(id, h); }
    return h;
  };
  for (const p of paths) {
    let m = HERO_MODEL_RE.exec(p) || CART_MODEL_RE.exec(p);
    if (m && !NON_HERO_FOLDER.has(m[1])) {
      const h = hero(m[1]);
      if (/\.vmdl_c$/.test(p)) {
        const stem = m[2].replace(/\.vmdl_c$/, '').split('/').pop() ?? '';
        const slot = slotFromModelStem(m[1], stem);
        if (slot === 'base') h.base = true; else h.slots.add(slot);
        h.models++;
      }
      continue;
    }
    // a cosmetic item: models/items/<hero>/<set>/<piece>.vmdl_c — never a base override,
    // so it adds a slot and never sets `base`
    m = ITEM_MODEL_RE.exec(p);
    if (m && !NON_HERO_FOLDER.has(m[1])) {
      const h = hero(m[1]);
      if (/\.vmdl_c$/.test(p)) {
        h.slots.add(slotFromModelStem(m[1], m[2].replace(/\.vmdl_c$/, '').split('/').pop() ?? ''));
        h.models++;
      }
      continue;
    }
    m = HERO_PARTICLE_RE.exec(p) || CART_PARTICLE_RE.exec(p) || ECON_PARTICLE_RE.exec(p) || ITEM_MATERIAL_RE.exec(p);
    if (m && !NON_HERO_FOLDER.has(m[1])) hero(m[1]);
  }
  // authors sometimes use both the canonical folder (nerubian_assassin) and a custom
  // alias (nyx, crystalmaiden) for the same hero — merge everything that resolves to the
  // same hero, and keep the id the engine itself uses so splitting can find the files
  const byKey = new Map<string, { id: string; name: string; slots: Set<string>; base: boolean; models: number }>();
  for (const [id, v] of heroes) {
    const key = heroKey(id);
    const cur = byKey.get(key) || { id, name: heroDisplayName(id), slots: new Set<string>(), base: false, models: 0 };
    // Of several spellings, keep the one the app has a proper name for: "crystal_maiden"
    // reads as "Crystal Maiden", the "crystalmaiden" an author typed reads as "Crystalmaiden".
    // The id matters too — splitting looks for the hero's files by it.
    if (HERO_DISPLAY[HERO_ALIAS[id] || id] && !HERO_DISPLAY[HERO_ALIAS[cur.id] || cur.id]) {
      cur.id = id;
      cur.name = heroDisplayName(id);
    }
    for (const s of v.slots) cur.slots.add(s);
    cur.base = cur.base || v.base;
    cur.models += v.models;
    byKey.set(key, cur);
  }
  const list = [...byKey.values()].map((v) => ({
    id: v.id, name: v.name, slots: [...v.slots], base: v.base, models: v.models,
  })).sort((a, b) => b.models - a.models || a.name.localeCompare(b.name));

  let kind = 'other';
  if (list.length) kind = 'hero';
  else if (paths.some((p) => /(^|\/)ward|models\/props_gameplay\/.*ward/.test(p))) kind = 'wards';
  else if (paths.some((p) => p.startsWith('particles/econ/courier') || p.includes('/courier'))) kind = 'courier';
  else if (paths.some((p) => p.startsWith('panorama/'))) kind = 'ui';
  else if (paths.some((p) => p.startsWith('sounds/'))) kind = 'sounds';
  else if (paths.some((p) => p.startsWith('maps/'))) kind = 'terrain';

  return { heroes: list, kind, pathCount: paths.length };
}

/** analyzeVpkPaths over the paths of one VPK. */
export function analyzeVpk(buf: Buffer): Analysis {
  return analyzeVpkPaths(listVpkPaths(buf));
}

/** Human one-liner for a single detected hero, e.g. "Nyx Assassin (model, weapon)". */
export function describeHero(h: HeroHit): string {
  const parts: string[] = [];
  if (h.base) parts.push(t('модель'));
  for (const s of h.slots) parts.push(slotDisplayName(s));
  if (!parts.length && !h.models) parts.push(t('перекраска'));
  return h.name + (parts.length ? ` (${parts.join(', ')})` : '');
}

const KIND_LABEL: Record<string, string> = { wards: 'варды', courier: 'курьер', ui: 'интерфейс', sounds: 'звуки', terrain: 'террейн', other: '' };

/**
 * The heroes a mod is actually about, as opposed to the ones it merely touches.
 *
 * A hero's folder is also where authors borrow generic lookup textures from - fresnel warps,
 * colourwarps, detail masks - and one borrowed file used to count as a whole hero. That is
 * how a set that dresses Grimstroke alone announced itself as a bundle of eight heroes, and
 * how a Dazzle skin claimed to also change Bane and Slardar (measured over 84 installed
 * mods: 12 heroes invented across 5 of them).
 *
 * A hero the mod carries no model for is not the subject. When none of them has a model the
 * mod is a plain recolour, and then every hero it touches is as good an answer as there is.
 *
 * Nor is a hero the mod carries one model for while carrying eight of somebody else's. Skins
 * borrow a prop from another hero - a Clinkz set hangs a Phoenix immortal off its bow, a Sven
 * one wears Disruptor's back piece - and that single model used to make the mod read as two
 * heroes. It came in named "Clinkz, Phoenix", and an import of two to four heroes splits
 * itself, so the set arrived in two halves with the bow in one of them.
 */
export function subjectHeroes(a: Analysis): HeroHit[] {
  const carried = a.heroes.filter((h) => h.models > 0 || h.base);
  if (carried.length < 2) return carried.length ? carried : a.heroes;
  // A quarter of the leading hero's models is the line between "this mod is also about him"
  // and "it borrowed something of his": measured across 75 split mods, every borrowed prop
  // was a single model against five to eight, and no real two-hero pack was near it.
  const top = Math.max(...carried.map((h) => h.models));
  const main = carried.filter((h) => h.base || h.models * 4 >= top);
  return main.length ? main : carried;
}

/** Human summary of a whole analysis: hero skins, or a coarse content kind. */
export function describeAnalysis(a: Analysis): string {
  const heroes = subjectHeroes(a);
  if (heroes.length) return heroes.map(describeHero).join('; ');
  return t(KIND_LABEL[a.kind] || '');
}

const KIND_NAME: Record<string, string> = { wards: 'Варды', courier: 'Курьер', ui: 'Интерфейс меню', sounds: 'Звуки', terrain: 'Ландшафт' };

/** A short display NAME for a mod from its analysis — used to name imported VPKs by their
 * content (a hero, a set, or a content kind) instead of a bare "pakNN" slot. Null if the
 * content isn't recognisable enough to name. */
export function nameFromAnalysis(a: Analysis): string | null {
  const heroes = subjectHeroes(a);
  if (heroes.length === 1) return heroes[0].name;
  if (heroes.length >= 2 && heroes.length <= 3) return heroes.map((h) => h.name).join(', ');
  if (heroes.length > 3) return t('Сборка · {0} героев', heroes.length);
  return KIND_NAME[a.kind] ? t(KIND_NAME[a.kind]) : null;
}

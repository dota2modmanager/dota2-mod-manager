// What the item builder's window shows beside the items, out of the game's own files: each hero's
// main attribute, which puts the heroes in the order the game's own hero grid has them (strength,
// agility, intelligence, universal), and a set's rarity, date, event and styles in the player's
// language (issue #526).
import { PAUSE } from './steps.ts';
import type { VpkIndex } from './vpk.ts';
import type { ItemSet } from './item-builder-sets.ts';

/** A hero's main attribute as the game's hero grid groups them. */
export type HeroAttribute = 'str' | 'agi' | 'int' | 'all';

const ATTRIBUTE: Record<string, HeroAttribute> = {
  DOTA_ATTRIBUTE_STRENGTH: 'str', DOTA_ATTRIBUTE_AGILITY: 'agi', DOTA_ATTRIBUTE_INTELLECT: 'int', DOTA_ATTRIBUTE_ALL: 'all',
};

/**
 * Each hero's main attribute, out of its script in the game's archive
 * (scripts/npc/heroes/npc_dota_hero_<id>.txt, "AttributePrimary"). A pause every sixteen heroes:
 * the 128 reads are a few milliseconds each on a cold disk. A hero whose script is missing is left
 * out, and the window puts it after the four groups.
 * @param ids  hero ids without the npc_dota_hero_ prefix
 */
export function* heroAttributesSteps(index: Pick<VpkIndex, 'read'>, ids: string[]): Generator<typeof PAUSE, Record<string, HeroAttribute>> {
  const out: Record<string, HeroAttribute> = {};
  let n = 0;
  for (const id of new Set(ids)) {
    if (++n % 16 === 0) yield PAUSE;
    if (!/^[a-z0-9_]+$/.test(id)) continue;
    try {
      const script = index.read(`scripts/npc/heroes/npc_dota_hero_${id}.txt`)?.toString('utf8') || '';
      const attr = ATTRIBUTE[/"AttributePrimary"\s+"(\w+)"/.exec(script)?.[1] || ''];
      if (attr) out[id] = attr;
    } catch { /* not in this game */ }
  }
  return out;
}

/** The words of an event id that are not a name of their own, in the order the game uses. */
const EVENT_WORDS: Record<string, string> = { INTERNATIONAL: 'The International', PLUS: 'Dota Plus', TEAM: 'Team' };

/**
 * An event id as a person reads it: "EVENT_ID_FALL_2021" is "Fall 2021", "EVENT_ID_INTERNATIONAL_2019"
 * "The International 2019". The game names its events only in pictures and store banners, so the
 * id is all there is to go on. A bare number and "EVENT_ID_NONE" are no event.
 */
export function eventName(id: string): string {
  const m = /^EVENT_ID_(.+)$/.exec(String(id || ''));
  if (!m || m[1] === 'NONE') return '';
  return m[1].split('_').map((w) => EVENT_WORDS[w] || (/^\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(' ');
}

/** A set as the window shows it: its name, rarity and description in the player's language, its event, and its styles' names. */
export type SetDetails = ItemSet & { title: string; rarityName: string; eventName: string; description: string; styleNames: string[] };

/**
 * @param named  the game's localization: a token's text, '' for one it lacks (cosmetic-names.ts styleNamer)
 * @param stylesOf  an item's style names in the player's language, by its id, for the items that have more than one
 */
export function setDetails(sets: ItemSet[], named: (token: string) => string, stylesOf: (itemId: string) => string[] | undefined): SetDetails[] {
  return sets.map((s) => {
    const most = s.pieces.find((p) => p.fits && (p.styles || 1) === s.styles);
    return {
      ...s,
      title: (s.nameToken && named(s.nameToken)) || s.name,
      rarityName: s.rarity ? named(`#Rarity_${s.rarity}`) || s.rarity.charAt(0).toUpperCase() + s.rarity.slice(1) : '',
      eventName: eventName(s.event),
      description: (s.descToken && named(s.descToken)) || '',
      styleNames: s.styles > 1 && most ? stylesOf(most.itemId) || [] : [],
    };
  });
}

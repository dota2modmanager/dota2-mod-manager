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

/**
 * An item's rarity key ("mythical") and the day it came out ("2021-09-01"), out of its block, for
 * the item builder's cards: each left out when the block does not say.
 */
export function itemFacts(block: string): { rarity?: string; date?: string } {
  const rarity = /\n\t*"item_rarity"\s+"(\w+)"/.exec(block)?.[1]?.toLowerCase();
  const date = /\n\t*"creation_date"\s+"(\d{4}-\d{2}-\d{2})/.exec(block)?.[1];
  return { ...(rarity ? { rarity } : {}), ...(date ? { date } : {}) };
}

/** The words of an event id that are not a name of their own, in the order the game uses. */
const EVENT_WORDS: Record<string, string> = { INTERNATIONAL: 'The International', PLUS: 'Dota Plus', TEAM: 'Team' };

/** The game's names for its events, by the words of the id run together in lower case ("spring2021"). */
export type EventNames = Map<string, string>;

// the window asks for the sets after every pick; the names are worked out once per table of tokens
const eventMemo = new WeakMap<Map<string, string>, EventNames>();

/**
 * The names the game gives its events, in the language of its text: DOTA_EventNameShort_* where
 * there is one ("The International 2019"), DOTA_EventName_* otherwise ("Nemestice"). Keyed without
 * underscores, because the ids and the tokens put them in different places: EVENT_ID_INTERNATIONAL_2019
 * is named by DOTA_EventNameShort_International2019, EVENT_ID_MUERTA_RELEASE_SPRING2023 by
 * DOTA_EventName_MuertaRelease_Spring2023.
 * @param tokens  the game's text in the app's language (src/cosmetic-names.ts gameTokens)
 */
export function eventNames(tokens: Map<string, string>): EventNames {
  const had = eventMemo.get(tokens);
  if (had) return had;
  const out: EventNames = new Map();
  const short = new Set<string>();
  for (const [key, value] of tokens) {
    const m = /^dota_eventname(short)?_(.+)$/.exec(key);
    if (!m || !value || value.startsWith('#')) continue;
    const id = m[2].replace(/_/g, '');
    if (m[1]) { out.set(id, value); short.add(id); } else if (!short.has(id)) out.set(id, value);
  }
  eventMemo.set(tokens, out);
  return out;
}

/**
 * An event id as a person reads it: the game's own name in the player's language where its text has
 * one, with the id's year when the name has no number of its own ("EVENT_ID_SPRING_2021" is
 * "Nemestice 2021", and "EVENT_ID_NEW_BLOOM_2019" "New Bloom 2019" beside "New Bloom 2020"); else the
 * id spelled out: "EVENT_ID_FALL_2025" is "Fall 2025", "EVENT_ID_10TH_ANNIVERSARY" "10th Anniversary".
 * A bare number and "EVENT_ID_NONE" are no event.
 * @param names  the game's event names (eventNames); without them every id is spelled out
 */
export function eventName(id: string, names: EventNames = new Map()): string {
  const m = /^EVENT_ID_(.+)$/.exec(String(id || ''));
  if (!m || m[1] === 'NONE') return '';
  const name = names.get(m[1].replace(/_/g, '').toLowerCase());
  const year = /20\d\d/.exec(m[1]);
  if (name) return year && !/\d/.test(name) ? `${name} ${year[0]}` : name;
  return m[1].split('_').map((w) => EVENT_WORDS[w] || w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/* Tags out until none is left: one pass over "<<b>font>" leaves "<font>" behind, because taking the
 * inner tag out joins the outer one's halves. */
function withoutTags(text: string): string {
  let out = text;
  for (let before = ''; before !== out;) { before = out; out = out.replace(/<\/?[a-z][^>]*>/gi, ''); }
  return out;
}

/**
 * A description as plain text. The game writes its texts for its own panels, with <br> for a new
 * line, font tags for colours and HTML entities, and the window shows text: 91 of the 1,102 set
 * descriptions of the game of 2026-11-09 showed their tags.
 */
function plainText(text: string): string {
  return withoutTags(text.replace(/<br\s*\/?>/gi, '\n'))
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? all;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A set as the window shows it: its name, rarity and description in the player's language, its event, and its styles' names. */
export type SetDetails = ItemSet & { title: string; rarityName: string; eventName: string; description: string; styleNames: string[] };

/**
 * @param named  the game's localization: a token's text, '' for one it lacks (cosmetic-names.ts styleNamer)
 * @param stylesOf  an item's style names in the player's language, by its id, for the items that have more than one
 * @param events  the game's event names in the player's language (eventNames)
 */
export function setDetails(sets: ItemSet[], named: (token: string) => string, stylesOf: (itemId: string) => string[] | undefined,
  events: EventNames = new Map()): SetDetails[] {
  return sets.map((s) => {
    const most = s.pieces.find((p) => p.fits && (p.styles || 1) === s.styles);
    return {
      ...s,
      title: (s.nameToken && named(s.nameToken)) || s.name,
      rarityName: s.rarity ? named(`#Rarity_${s.rarity}`) || s.rarity.charAt(0).toUpperCase() + s.rarity.slice(1) : '',
      eventName: eventName(s.event, events),
      description: plainText((s.descToken && named(s.descToken)) || ''),
      styleNames: s.styles > 1 && most ? stylesOf(most.itemId) || [] : [],
    };
  });
}

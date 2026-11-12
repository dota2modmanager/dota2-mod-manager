/* The item builder's rules, out of its screen (views/item-builder.ts): what the one button does
 * with what is chosen, which heroes and sets a search leaves, and what a hero's card says. What a
 * pick does to the game is src/item-builder.ts. */
import { plural } from '../../ui/format.ts';
import { cosmeticNameMatches } from '../../ui/cosmetic-name.ts';
import type { CosmeticSet, CosmeticSlot, HeroAttribute } from '../types.ts';
import type { BuilderAction } from './model.ts';

type ItemSlot = CosmeticSlot;
type ItemSet = CosmeticSet;
type ItemEffect = { id: string; name: string };
/** What the game shows on a slot now (core/installed.ts pickedIn). */
interface LivePick { itemId?: string; name?: string; effectId?: string }

type PickedIn = (slot: string) => LivePick | null | undefined;

/** The effects of a pick in the order the slot offers them, as one string: 'fire,snow'; then the item
 *  whose effect it wears, 'from-7365' (src/item-builder-donor.ts); and its style last when it is not
 *  the item's first, 'fire,snow,style-2' (src/item-builder.ts effectKey). */
export function effectKey(effects: ItemEffect[] | undefined, ids: string[] | undefined, style = 0, donor = ''): string {
  const want = new Set(ids || []);
  const fx = (effects || []).map((e) => e.id).filter((id) => id && want.has(id));
  return [...fx, ...(donor ? [`from-${donor}`] : []), ...(style > 0 ? [`style-${style}`] : [])].join(',');
}

const DONOR = /^from-(\d+)$/;

/** The item whose effect a record wears, '' for none. */
export function liveDonor(live: LivePick | null | undefined): string {
  const token = String(live?.effectId || '').split(',').find((id) => DONOR.test(id));
  return token ? DONOR.exec(token)![1] : '';
}

const STYLE = /^style-(\d+)$/;

/** A record's effects as a list (a record keeps them comma separated, src/item-builder.ts effectKey). */
export function liveEffects(live: LivePick | null | undefined): string[] {
  return live?.effectId ? String(live.effectId).split(',').filter((id) => id && !STYLE.test(id) && !DONOR.test(id)) : [];
}

/** A record's style: the number its key carries ('style-2'), 0 for the item's first. */
export function liveStyle(live: LivePick | null | undefined): number {
  const token = String(live?.effectId || '').split(',').find((id) => STYLE.test(id));
  return token ? Number(STYLE.exec(token)![1]) : 0;
}

/**
 * What the slot window's button does with what is chosen in it. Nothing reaches the game until it
 * is pressed: a pick used to be written on every click, and choosing three effects meant three
 * writes and three toasts.
 */
export function stagedItemAction(
  effects: ItemEffect[] | undefined,
  live: LivePick | null | undefined,
  st: { busy: boolean; selectedId: string; effectIds: string[]; style?: number; donor?: string },
): BuilderAction {
  if (st.busy) return { label: L`Надеваю…`, icon: 'hourglass_top', off: true };
  if (!st.selectedId) {
    return live ? { label: L`Вернуть стандартный`, icon: 'undo', remove: true } : { label: L`Надето`, icon: 'check', off: true };
  }
  if (live?.itemId !== st.selectedId) return { label: L`Надеть`, icon: 'checkroom' };
  if (effectKey(effects, st.effectIds, 0, st.donor) !== effectKey(effects, liveEffects(live), 0, liveDonor(live))) return { label: L`Сохранить эффекты`, icon: 'auto_awesome' };
  return (st.style || 0) === liveStyle(live)
    ? { label: L`Надето`, icon: 'check', off: true }
    : { label: L`Сохранить стиль`, icon: 'palette' };
}

// The effects that ship with a picture, so the shelf shows them at once on any machine. A fixed
// set, so the screen never has to ask what is in a folder: the builder's own ids, and the game's
// unusual ones tools/effect-pictures.mjs drew. Any other effect (a patch's new one) is drawn live,
// which takes seconds of WebGL each (preview3d/effect-thumb.ts).
const EFFECT_PICTURES = new Set([
  'bubbles', 'fire', 'frostbloom', 'ghost', 'lightnings', 'sand-storm', 'snow',
  'unusual-15', 'unusual-21', 'unusual-22', 'unusual-32', 'unusual-46', 'unusual-47',
  'unusual-57', 'unusual-61', 'unusual-68', 'unusual-73', 'unusual-74', 'unusual-76',
  'unusual-109', 'unusual-129', 'unusual-138', 'unusual-155', 'unusual-156', 'unusual-157',
  'unusual-158', 'unusual-159', 'unusual-185', 'unusual-196', 'unusual-205', 'unusual-206',
  'unusual-268', 'unusual-827', 'unusual-833', 'unusual-834', 'unusual-835', 'unusual-836',
  'unusual-837',
]);

export const effectPicture = (id: string): string | null => (EFFECT_PICTURES.has(id) ? `./assets/effects/${id}.webp` : null);

/** An option's tags as its card prints them: once each, lower case. */
export const tagLine = (tags: string[] | undefined): string => [...new Set((tags || []).map((t) => String(t).toLowerCase()))].join(', ');

export const byName = <T extends { name: string }>(list: T[], query: string): T[] => {
  const q = query.trim().toLowerCase();
  return q ? list.filter((o) => cosmeticNameMatches(o.name, q)) : list;
};

/** A set is found by its own name or by any piece's. */
export function matchingSets(sets: ItemSet[], query: string): ItemSet[] {
  const q = query.trim().toLowerCase();
  return q ? sets.filter((s) => [s.name, ...s.pieces.map((p) => p.name)].some((n) => cosmeticNameMatches(n, q))) : sets;
}

/** Each piece the builder puts on is on already, whatever effects it carries. */
export const setIsOn = (set: ItemSet, pickedIn: PickedIn): boolean =>
  set.pieces.every((p) => !p.fits || pickedIn(p.slot)?.itemId === p.itemId);

/** The heroes with a persona picked, by the id their slots carry. */
export function personaHeroes(slots: ItemSlot[], pickedIn: PickedIn): Set<string> {
  return new Set(slots.filter((s) => s.persona && !s.persona.part && pickedIn(s.slot)).map((s) => s.persona!.hero));
}

/**
 * The slots on offer once the personas picked are counted (src/item-builder-personas.ts): a hero
 * with a persona on shows the persona's slot and its own ones alone, and a hero without one shows
 * its plain slots and the slot to pick a persona in. A persona is worn with its own items only.
 */
export function withPersonas<T extends ItemSlot>(slots: T[], pickedIn: PickedIn): T[] {
  const on = personaHeroes(slots, pickedIn);
  if (!on.size) return slots.filter((s) => !s.persona?.part);
  return slots.filter((s) => (s.persona ? !s.persona.part || on.has(s.persona.hero) : !(s.heroIds || []).some((h) => on.has(h))));
}

/** The four groups of the game's hero grid, in its order. */
export const ATTRIBUTES: HeroAttribute[] = ['str', 'agi', 'int', 'all'];

/** A hero's place among the groups: its attribute's, or after them for a hero the game did not say. */
export const attributeRank = (slots: ItemSlot[], attrs: Record<string, HeroAttribute>): number => {
  const at = ATTRIBUTES.indexOf(attrs[slots[0]?.heroIds?.[0] || '']);
  return at === -1 ? ATTRIBUTES.length : at;
};

/**
 * The builder's slots by the hero they belong to, in the order of the game's hero grid: strength,
 * agility, intelligence, universal, each alphabetical (attrs: src/item-builder-details.ts). Without
 * the attributes, alphabetical.
 */
export function heroesOf(slots: ItemSlot[], attrs: Record<string, HeroAttribute> = {}): [string, ItemSlot[]][] {
  const heroes = new Map<string, ItemSlot[]>();
  for (const s of slots) {
    const key = s.heroLabel || s.label || s.slot;
    heroes.set(key, [...(heroes.get(key) || []), s]);
  }
  return [...heroes.entries()].sort((a, b) => attributeRank(a[1], attrs) - attributeRank(b[1], attrs) || a[0].localeCompare(b[0]));
}

// What is on the hero, rather than how many slots it has: 92 of 124 heroes have four to six, so
// "5 slots" told nobody anything, and a dressed hero said only that it was dressed.
export function heroCardMeta(slots: ItemSlot[], sets: ItemSet[], pickedIn: PickedIn): string {
  const worn = sets.find((s) => setIsOn(s, pickedIn));
  if (worn) return worn.name;
  const changed = slots.filter((s) => pickedIn(s.slot)).length;
  if (changed) return L`Изменено ${changed} из ${slots.length}`;
  return sets.length
    ? `${sets.length} ${plural(sets.length, 'набор', 'набора', 'наборов')}`
    : `${slots.length} ${plural(slots.length, 'слот', 'слота', 'слотов')}`;
}

// A line only where it tells something: 1914 of 1925 sets fit whole, and "5 pieces" on every card
// said nothing.
export function setCardMeta(set: ItemSet, on: boolean): string {
  const n = set.pieces.length;
  return on ? L`Надето` : set.fit < n ? L`${set.fit} из ${n}` : ' ';
}

export function setCount(set: ItemSet): string {
  const n = set.pieces.length;
  return set.fit < n ? L`${set.fit} из ${n} ${plural(n, 'детали', 'деталей', 'деталей')}` : `${n} ${plural(n, 'деталь', 'детали', 'деталей')}`;
}

/** The shelves of a slot's effects tab: the hero's kinetic gems, the courier unusuals, the seasonal ones, and the ambients of particular couriers. */
export type EffectGroup = 'kinetic' | 'unusual' | 'seasonal' | 'courier';

// the builder's own effects by what the game draws them for (src/item-builder-effects.ts); the
// game's are unusual-<number>, and its numbers from 800 up are the seasonal ones (Frostbloom 826)
const OWN_GROUP: Record<string, EffectGroup> = {
  fire: 'unusual', lightnings: 'unusual', frostbloom: 'seasonal', snow: 'seasonal', bubbles: 'seasonal', 'sand-storm': 'courier', ghost: 'courier',
};
export const effectGroup = (id: string): EffectGroup => (id.startsWith('kinetic-') ? 'kinetic' : OWN_GROUP[id]) || (Number(/^unusual-(\d+)$/.exec(id)?.[1]) >= 800 ? 'seasonal' : 'unusual');

/** A rarity key as the game prints it in every language: "mythical" is "Mythical". */
export const rarityName = (key: string | undefined): string => (key ? key.charAt(0).toUpperCase() + key.slice(1) : '');

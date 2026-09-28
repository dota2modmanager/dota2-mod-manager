/* The item builder's rules, out of its screen (views/item-builder.ts): what the one button does
 * with what is chosen, which heroes and sets a search leaves, and what a hero's card says. What a
 * pick does to the game is src/item-builder.js. */
import { plural } from '../../ui/format.js';
import type { CosmeticSet, CosmeticSlot } from '../types.ts';
import type { BuilderAction } from './model.ts';

type ItemSlot = CosmeticSlot;
type ItemSet = CosmeticSet;
type ItemEffect = { id: string; name: string };
/** What the game shows on a slot now (core/installed.js pickedIn). */
export interface LivePick { itemId?: string; name?: string; effectId?: string }

export type PickedIn = (slot: string) => LivePick | null | undefined;

/** The effects of a pick in the order the slot offers them, as one string: 'fire,snow'. */
export function effectKey(effects: ItemEffect[] | undefined, ids: string[] | undefined): string {
  const want = new Set(ids || []);
  return (effects || []).map((fx) => fx.id).filter((id) => id && want.has(id)).join(',');
}

/** A record's effects as a list (a record keeps them comma separated, src/item-builder.js effectKey). */
export function liveEffects(live: LivePick | null | undefined): string[] {
  return live?.effectId ? String(live.effectId).split(',').filter(Boolean) : [];
}

/**
 * What the slot window's button does with what is chosen in it. Nothing reaches the game until it
 * is pressed: a pick used to be written on every click, and choosing three effects meant three
 * writes and three toasts.
 */
export function stagedItemAction(
  effects: ItemEffect[] | undefined,
  live: LivePick | null | undefined,
  st: { busy: boolean; selectedId: string; effectIds: string[] },
): BuilderAction {
  if (st.busy) return { label: L`Надеваю…`, icon: 'hourglass_top', off: true };
  if (!st.selectedId) {
    return live ? { label: L`Вернуть стандартный`, icon: 'undo', remove: true } : { label: L`Надето`, icon: 'check', off: true };
  }
  if (live?.itemId !== st.selectedId) return { label: L`Надеть`, icon: 'checkroom' };
  return effectKey(effects, st.effectIds) === effectKey(effects, liveEffects(live))
    ? { label: L`Надето`, icon: 'check', off: true }
    : { label: L`Сохранить эффекты`, icon: 'auto_awesome' };
}

// The effects that have a picture. A fixed set, the same ids src/item-builder.js offers, so the
// screen never has to ask what is in a folder.
const EFFECT_PICTURES = new Set(['bubbles', 'fire', 'frostbloom', 'ghost', 'lightnings', 'sand-storm', 'snow']);

export const effectPicture = (id: string): string | null => (EFFECT_PICTURES.has(id) ? `./assets/effects/${id}.webp` : null);

/** An option's tags as its card prints them: once each, lower case. */
export const tagLine = (tags: string[] | undefined): string => [...new Set((tags || []).map((t) => String(t).toLowerCase()))].join(', ');

export const byName = <T extends { name: string }>(list: T[], query: string): T[] => {
  const q = query.trim().toLowerCase();
  return q ? list.filter((o) => o.name.toLowerCase().includes(q)) : list;
};

/** A set is found by its own name or by any piece's. */
export function matchingSets(sets: ItemSet[], query: string): ItemSet[] {
  const q = query.trim().toLowerCase();
  return q ? sets.filter((s) => [s.name, ...s.pieces.map((p) => p.name)].some((n) => n.toLowerCase().includes(q))) : sets;
}

/** Each piece the builder puts on is on already, whatever effects it carries. */
export const setIsOn = (set: ItemSet, pickedIn: PickedIn): boolean =>
  set.pieces.every((p) => !p.fits || pickedIn(p.slot)?.itemId === p.itemId);

/** The builder's slots by the hero they belong to, heroes in alphabetical order. */
export function heroesOf(slots: ItemSlot[]): [string, ItemSlot[]][] {
  const heroes = new Map<string, ItemSlot[]>();
  for (const s of slots) {
    const key = s.heroLabel || s.label || s.slot;
    heroes.set(key, [...(heroes.get(key) || []), s]);
  }
  return [...heroes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
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

/* The item builder's offer: for each hero, the slots it can dress, the paid wearables that fit
 * each one, the sets they belong to, and the particle effects that can go on top. What a pick
 * then writes into items_game is src/item-builder.ts, which callers import this through.
 *
 * Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
 * (https://github.com/TheFleece).
 * Copyright (C) 2026 h6rd
 * Copyright (C) 2026 TheFleece
 * SPDX-License-Identifier: GPL-3.0-or-later
 * The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
 * the credits of the program it goes into.
 */
import { heroDisplayName } from './vpk.ts';
import { t } from './i18n.ts';
import { listItemsSteps, toUtf8, eachChild, blockBounds, itemSearchText, inferredItemSlot, type SchemaItem } from './schema.ts';
import { drain, PAUSE } from './steps.ts';
import { styleTokens } from './item-builder-styles.ts';
import { itemNote, untilReconnect, type ItemNote } from './arcana-notes.ts';
import { personaSlots } from './item-builder-personas.ts';
import { hasOwnEffect } from './item-builder-donor.ts';
import { itemFacts } from './item-builder-details.ts';
import { fxSlotLabel, fxSlotOf, fxSlots } from './item-builder-ability-fx.ts';

/** A slot of a hero the builder can dress, and the paid items that fit it. */
export interface ItemSlot {
  slot: string; kind: 'item-effect'; base: string; targetId: string; equipSlot: string; heroIds: string[];
  heroLabel: string; slotLabel: string; label: string; icon: string;
  /** `styles`: the name token of each style, for an item with more than one (src/item-builder-styles.ts); `note`: what is
   *  known to go wrong with it in the game, or that nobody has checked (src/arcana-notes.ts); `fx`: a particle of its own, for another item to wear (src/item-builder-donor.ts); `rarity`, `date`: src/item-builder-details.ts itemFacts */
  options: { id: string; name: string; styles?: string[]; note?: ItemNote; fx?: true; rarity?: string; date?: string }[];
  /** a persona's slot (src/item-builder-personas.ts): `part` false where the persona is picked */
  persona?: { hero: string; part: boolean };
  /** an ability effects slot's number: its picks give their effects, not their model (src/item-builder-ability-fx.ts) */
  abilityFx?: number;
}

/** An item's visuals block, as text; null when it has none. */
function visualsOf(text: string, item: { start: number }): string | null {
  let out: string | null = null;
  eachChild(text, blockBounds(text, item.start), (c) => { if (!out && c.isBlock && c.key.toLowerCase() === 'visuals') out = text.slice(c.start, c.end); });
  return out;
}

/**
 * A file in the game's archive staged under another path in the built VPK; an `optional` one (a
 * picture the game has in some of its folders only) is left out when the game has not got it. A hero's own model
 * names the hero instead of a path: where its model lives is in the hero's script, which the
 * table does not say, and it goes in with the item's activity modifiers taken off (arcana.ts asModel).
 * A summon's (forged spirits) names its unit, and is numbered as the plain model (model-sequences.ts).
 */
export type AssetCopy = { from: string; to: string; optional?: boolean; skin?: number } | { from: string; hero: string; activities: string[]; skin?: number } | { from: string; to: string; unit: string; skin?: number };

const ITEM_SLOT_MATCH_ALIAS: Record<string, string> = {
  offhand_weapon: 'offhand',
  offhand: 'offhand',
  shoulder: 'shoulders',
  shoulders: 'shoulders',
  arm: 'arms',
  arms: 'arms',
};

const ITEM_SLOT_LABEL: Record<string, string> = {
  head: 'голова', body_head: 'голова (2)', hair: 'волосы', weapon: 'оружие', offhand: 'оружие (2)', offhand_weapon: 'доп. оружие', shield: 'щит', armor: 'броня',
  shoulder: 'плечи', shoulders: 'плечи', neck: 'шея', belt: 'пояс', arm: 'руки', arms: 'руки', gloves: 'перчатки', back: 'спина',
  wings: 'крылья', tail: 'хвост', legs: 'ноги', mount: 'ездовое', costume: 'костюм', misc: 'разное', ambient: 'эффекты', ambient_effects: 'эффекты',
  ability1: 'способность 1', ability2: 'способность 2', ability3: 'способность 3', ability4: 'способность 4', ability_ultimate: 'ультимейт',
  summon: 'призыв', voice: 'голос', shapeshift: 'форма', hero_base: 'база героя', persona_selector: 'персона',
};

const ITEM_SLOT_ORDER = [
  'persona_selector', 'head', 'body_head', 'hair', 'neck', 'shoulder', 'shoulders', 'arm', 'arms', 'gloves', 'back', 'weapon', 'offhand', 'offhand_weapon',
  'shield', 'armor', 'belt', 'legs', 'mount', 'wings', 'tail', 'costume', 'ambient', 'ambient_effects', 'ability1', 'ability2', 'ability3',
  'ability4', 'ability_ultimate', 'summon', 'voice', 'shapeshift', 'misc',
  ...Array.from({ length: 9 }, (_, i) => `ability_effects_${i + 1}`),
];

/** A hero id as the builder keys its slots: no npc_dota_hero_ prefix, lower case, Io as the table names it (wisp). */
export function canonicalHeroId(hero: unknown): string {
  const clean = String(hero || '').toLowerCase().replace(/^npc_dota_hero_/, '');
  return clean === 'io' ? 'wisp' : clean;
}

/** A slot name as the table writes it, lower-cased; empty for none. */
export function canonicalItemSlot(slot: unknown): string {
  return String(slot || '').toLowerCase();
}

/** A slot name with its aliases folded together (offhand_weapon is offhand, shoulder is shoulders). */
export function matchItemSlot(slot: unknown): string {
  const clean = canonicalItemSlot(slot);
  return ITEM_SLOT_MATCH_ALIAS[clean] || clean;
}

/** A builder slot's id: its heroes and its slot, item:pudge:weapon. */
export function itemSlotId(heroIds: string[], slot: string): string {
  return `item:${heroIds.join('+')}:${slot}`;
}

function titleLabel(text: unknown): string {
  const s = String(text || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** A slot's name as a tile says it, in the user's language: "Оружие". */
export function slotDisplayLabel(slot: string): string {
  const equipSlot = canonicalItemSlot(slot);
  if (fxSlotOf(equipSlot)) return fxSlotLabel(fxSlotOf(equipSlot));
  return titleLabel(t(ITEM_SLOT_LABEL[equipSlot] || equipSlot.replace(/_/g, ' ')));
}

/** A slot's name with its heroes ahead of it, for a slot shown away from its hero: "Pudge · Оружие". */
export function itemSlotLabel(heroIds: string[], slot: string): string {
  const heroes = heroIds.map((id) => heroDisplayName(canonicalHeroId(id))).join(' / ');
  return `${heroes} · ${slotDisplayLabel(slot)}`;
}

/**
 * A persona, by its name or its slot: the plain hero's slots leave these out. A persona is a
 * second hero with slots of its own, offered apart once it has a base (personaSlots).
 *
 * Arcanas used to be left alone as well, and so did the hero_base slot most of them sit in. They
 * are items like any other: each hero with a hero_base arcana has a stock "<Hero>'s Base" to
 * dress (twelve on the game of 2026-10-15), and what an arcana needs beyond its block is its hero
 * model under the plain one's path, which item-builder.ts itemEffectPatch now lists.
 */
export function isPersonaItem(item: Partial<SchemaItem> | null): boolean {
  const slot = canonicalItemSlot(inferredItemSlot(item));
  return itemSearchText(item).includes('persona')
    || slot === 'persona_selector'
    || /_persona_\d+$/i.test(slot);
}

/** The icon a slot's tile shows while nothing in it has a picture. */
export function itemSlotIcon(slot: string): string {
  if (fxSlotOf(slot)) return 'auto_awesome';
  return ({
    head: 'face', body_head: 'face', hair: 'content_cut', neck: 'checkroom', weapon: 'swords', offhand: 'shield', offhand_weapon: 'shield', shield: 'shield', armor: 'security',
    shoulder: 'accessibility_new', shoulders: 'accessibility_new', belt: 'checkroom', arm: 'front_hand', arms: 'front_hand', gloves: 'front_hand', back: 'checkroom',
    wings: 'flutter_dash', tail: 'gesture', legs: 'directions_run', mount: 'pets', costume: 'checkroom', ambient: 'auto_awesome', ambient_effects: 'auto_awesome',
    ability1: 'auto_fix_high', ability2: 'auto_fix_high', ability3: 'auto_fix_high', ability4: 'auto_fix_high', ability_ultimate: 'flash_on',
    summon: 'pets', voice: 'mic', shapeshift: 'pets', misc: 'checkroom', persona_selector: 'theater_comedy',
  } as Record<string, string>)[canonicalItemSlot(slot)] || 'checkroom';
}

/** Hero item slots built from real default_item entries, with one donor list per hero part. */
export function itemSlots(text: string): ItemSlot[] {
  return drain(itemSlotsSteps(text));
}

/** itemSlots, a pause every couple of thousand items: the table's 26 000 are a quarter of a second. */
export function* itemSlotsSteps(text: string): Generator<typeof PAUSE, ItemSlot[]> {
  const items = yield* listItemsSteps(text);
  let n = 0;
  const heroCache = new Map<string, string[]>();
  const heroesOf = (item: SchemaItem): string[] => {
    let heroes = heroCache.get(item.id);
    if (!heroes) { heroes = itemHeroes(text, item); heroCache.set(item.id, heroes); }
    return heroes;
  };
  const slots = new Map<string, ItemSlot>();
  const matchSlots = new Map<string, string[]>();
  // the stock items with no model of their own: a pick for their slot has no path to go under
  const bare = new Set<string>();
  for (const item of items) {
    if (++n % 2000 === 0) yield PAUSE;
    const equipSlot = canonicalItemSlot(inferredItemSlot(item));
    if (item.prefab !== 'default_item' || !equipSlot || isPersonaItem(item)) continue;
    const heroes = heroesOf(item);
    if (!heroes.length) continue;
    const heroIds = heroes.map(canonicalHeroId);
    const slotId = itemSlotId(heroIds, equipSlot);
    if (!item.model) bare.add(item.id);
    slots.set(slotId, {
      slot: slotId,
      kind: 'item-effect',
      base: item.id,
      targetId: item.id,
      equipSlot,
      heroIds,
      heroLabel: heroIds.map((id) => heroDisplayName(canonicalHeroId(id))).join(' / '),
      slotLabel: slotDisplayLabel(equipSlot),
      label: itemSlotLabel(heroIds, equipSlot),
      icon: itemSlotIcon(equipSlot),
      options: [],
    });
    const matchKey = itemSlotId(heroIds, matchItemSlot(equipSlot));
    const hits = matchSlots.get(matchKey) || [];
    hits.push(slotId);
    matchSlots.set(matchKey, hits);
  }
  for (const item of items) {
    if (++n % 2000 === 0) yield PAUSE;
    const equipSlot = canonicalItemSlot(inferredItemSlot(item));
    if (item.prefab !== 'wearable' || !equipSlot || !item.name || isPersonaItem(item)) continue;
    const heroes = heroesOf(item);
    if (!heroes.length) continue;
    const heroIds = heroes.map(canonicalHeroId);
    const slotId = itemSlotId(heroIds, equipSlot);
    let target: ItemSlot | null | undefined = slots.get(slotId);
    if (!target) {
      const hits = matchSlots.get(itemSlotId(heroIds, matchItemSlot(equipSlot))) || [];
      if (hits.length === 1) target = slots.get(hits[0]) || null;
    }
    if (!target) continue;
    const block = text.slice(item.start, item.end);
    const styles = block.includes('"styles"') ? styleTokens(visualsOf(text, item)) : [];
    const noted = itemNote(heroIds, block, item.id);
    const note = item.model && bare.has(target.base) ? untilReconnect(noted, t) : noted && { status: noted.status, text: t(noted.note) };
    target.options.push({
      id: item.id, name: toUtf8(item.name), ...itemFacts(block),
      ...(styles.length ? { styles } : {}), ...(note ? { note } : {}), ...(hasOwnEffect(block, () => visualsOf(text, item)) ? { fx: true as const } : {}),
    });
  }
  for (const s of personaSlots(text)) slots.set(s.slot, s);
  // the hidden ones the game wears an item's ability effects in, without its model
  yield PAUSE;
  for (const s of fxSlots(text, items, heroesOf, slotFields)) slots.set(s.slot, s);

  const order = new Map(ITEM_SLOT_ORDER.map((slot, i) => [slot, i]));
  return [...slots.values()]
    .filter((s) => s.options.length)
    .map((s) => ({ ...s, options: s.options.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => {
      const byHero = a.label.localeCompare(b.label);
      if (byHero && a.heroIds.join(',') !== b.heroIds.join(',')) return byHero;
      return (order.get(a.equipSlot) ?? 999) - (order.get(b.equipSlot) ?? 999) || a.label.localeCompare(b.label);
    });
}

/** A slot of one hero, with nothing in it yet. */
function slotFields(hero: string, equipSlot: string, targetId: string): ItemSlot {
  const heroIds = [canonicalHeroId(hero)];
  return {
    slot: itemSlotId(heroIds, equipSlot), kind: 'item-effect', base: targetId, targetId, equipSlot, heroIds,
    heroLabel: heroDisplayName(heroIds[0]), slotLabel: slotDisplayLabel(equipSlot), label: itemSlotLabel(heroIds, equipSlot), icon: itemSlotIcon(equipSlot), options: [],
  };
}

/** Wearable items with visuals and a matching stock default_item, offered under cosmetics/items. */
export function itemOptions(text: string): { id: string; name: string }[] {
  return itemSlots(text).flatMap((slot) => slot.options);
}

/** The heroes an item block says it is used by, as npc_dota_hero_* ids. */
export function itemHeroes(text: string, item: { start: number }): string[] {
  const out: string[] = [];
  eachChild(text, blockBounds(text, item.start), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'used_by_heroes') return;
    eachChild(text, c.body, (h) => {
      if (h.isBlock || h.value !== '1' || !/^npc_dota_hero_/i.test(h.key)) return;
      out.push(h.key.toLowerCase());
    });
  });
  return out.sort();
}

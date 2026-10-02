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
import { listItems, toUtf8, eachChild, blockBounds, itemSearchText, inferredItemSlot, type SchemaItem } from './schema.ts';

/** A slot of a hero the builder can dress, and the paid items that fit it. */
export interface ItemSlot {
  slot: string; kind: 'item-effect'; base: string; targetId: string; equipSlot: string; heroIds: string[];
  heroLabel: string; slotLabel: string; label: string; icon: string; options: { id: string; name: string }[];
}

/** One piece of a set: where it goes, or why it does not. */
type SetPiece =
  | { name: string; itemId: string; fits: true; slot: string; slotLabel: string }
  | { name: string; itemId: string; fits: false; reason: string };

/** A set, as the builder puts it on; see itemSets. */
export interface ItemSet { id: string; name: string; heroIds: string[]; fit: number; heroLabel: string; pieces: SetPiece[] }

/** A file in the game's archive staged under another path in the built VPK. */
export type AssetCopy = { from: string; to: string };

const ITEM_HIDDEN_HEROES = new Set(['wisp', 'io']);

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
  summon: 'призыв', voice: 'голос', shapeshift: 'форма', hero_base: 'база героя',
};

const ITEM_SLOT_ORDER = [
  'head', 'body_head', 'hair', 'neck', 'shoulder', 'shoulders', 'arm', 'arms', 'gloves', 'back', 'weapon', 'offhand', 'offhand_weapon',
  'shield', 'armor', 'belt', 'legs', 'mount', 'wings', 'tail', 'costume', 'ambient', 'ambient_effects', 'ability1', 'ability2', 'ability3',
  'ability4', 'ability_ultimate', 'summon', 'voice', 'shapeshift', 'misc',
];

function canonicalHeroId(hero: unknown): string {
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

function hiddenItemHeroes(heroes: string[]): boolean {
  return heroes.some((hero) => ITEM_HIDDEN_HEROES.has(canonicalHeroId(hero)));
}

function itemSlotId(heroIds: string[], slot: string): string {
  return `item:${heroIds.join('+')}:${slot}`;
}

function titleLabel(text: unknown): string {
  const s = String(text || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function slotDisplayLabel(slot: string): string {
  const equipSlot = canonicalItemSlot(slot);
  return titleLabel(t(ITEM_SLOT_LABEL[equipSlot] || equipSlot.replace(/_/g, ' ')));
}

function itemSlotLabel(heroIds: string[], slot: string): string {
  const heroes = heroIds.map((id) => heroDisplayName(canonicalHeroId(id))).join(' / ');
  return `${heroes} · ${slotDisplayLabel(slot)}`;
}

/** An arcana, a persona or a hero's base model, by its name or its slot: the builder leaves these alone. */
export function isArcanaPersonaItem(item: Partial<SchemaItem> | null): boolean {
  const text = itemSearchText(item);
  const slot = canonicalItemSlot(inferredItemSlot(item));
  return text.includes('arcana')
    || text.includes('persona')
    || slot === 'persona_selector'
    || /_persona_\d+$/i.test(slot)
    || slot === 'hero_base'
    || slot === 'voice_persona_1'
    || slot === 'summon_persona_1'
    || slot === 'shapeshift_persona_1';
}

function itemSlotIcon(slot: string): string {
  return ({
    head: 'face', body_head: 'face', hair: 'content_cut', neck: 'checkroom', weapon: 'swords', offhand: 'shield', offhand_weapon: 'shield', shield: 'shield', armor: 'security',
    shoulder: 'accessibility_new', shoulders: 'accessibility_new', belt: 'checkroom', arm: 'front_hand', arms: 'front_hand', gloves: 'front_hand', back: 'checkroom',
    wings: 'flutter_dash', tail: 'gesture', legs: 'directions_run', mount: 'pets', costume: 'checkroom', ambient: 'auto_awesome', ambient_effects: 'auto_awesome',
    ability1: 'auto_fix_high', ability2: 'auto_fix_high', ability3: 'auto_fix_high', ability4: 'auto_fix_high', ability_ultimate: 'flash_on',
    summon: 'pets', voice: 'mic', shapeshift: 'pets', misc: 'checkroom',
  } as Record<string, string>)[canonicalItemSlot(slot)] || 'checkroom';
}

/** Hero item slots built from real default_item entries, with one donor list per hero part. */
export function itemSlots(text: string): ItemSlot[] {
  const items = listItems(text);
  const heroCache = new Map<string, string[]>();
  const heroesOf = (item: SchemaItem): string[] => {
    let heroes = heroCache.get(item.id);
    if (!heroes) { heroes = itemHeroes(text, item); heroCache.set(item.id, heroes); }
    return heroes;
  };
  const slots = new Map<string, ItemSlot>();
  const matchSlots = new Map<string, string[]>();
  for (const item of items) {
    const equipSlot = canonicalItemSlot(inferredItemSlot(item));
    if (item.prefab !== 'default_item' || !equipSlot || isArcanaPersonaItem(item)) continue;
    const heroes = heroesOf(item);
    if (!heroes.length || hiddenItemHeroes(heroes)) continue;
    const heroIds = heroes.map(canonicalHeroId);
    const slotId = itemSlotId(heroIds, equipSlot);
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
    const equipSlot = canonicalItemSlot(inferredItemSlot(item));
    if (item.prefab !== 'wearable' || !equipSlot || !item.name || isArcanaPersonaItem(item)) continue;
    const heroes = heroesOf(item);
    if (!heroes.length || hiddenItemHeroes(heroes)) continue;
    const heroIds = heroes.map(canonicalHeroId);
    const slotId = itemSlotId(heroIds, equipSlot);
    let target: ItemSlot | null | undefined = slots.get(slotId);
    if (!target) {
      const hits = matchSlots.get(itemSlotId(heroIds, matchItemSlot(equipSlot))) || [];
      if (hits.length === 1) target = slots.get(hits[0]) || null;
    }
    if (!target) continue;
    target.options.push({ id: item.id, name: toUtf8(item.name) });
  }

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

/**
 * A hero's sets as the builder puts them on: every wearable of the set that has a slot in the
 * builder, in one write (schema-service pickSet).
 *
 * A set used to be one more slot, "bundle", put on as if it were one item. It is several, with
 * no stock item to stand in for, so on the game of 2026-09-24 1760 of its 1971 choices did not
 * build and the other 211 put a model-less block over whichever stock item came first.
 *
 * Only hero items are listed. A set's loading screen, cursor, HUD, ward, announcer or taunt
 * has a tab of its own or is not the app's to set, and nobody puts one on with a set. A hero
 * item the builder leaves alone (an arcana, a persona) is listed as not fitting, with why: it
 * is part of what the set looks like. A set with nothing to put on is left out, and so is a store
 * bundle of several sets ("Bounty Hunter's Big Bundle": 22 items, 7 slots): more of its pieces
 * want a taken slot than fit, and the first of each would dress the hero in a mix of sets that
 * are each listed on their own anyway. Valve's "DO NOT USE" is left out as well.
 * @param text  items_game
 * @param slots  itemSlots(text), when the caller has it already
 */
export function itemSets(text: string, slots: Pick<ItemSlot, 'slot' | 'slotLabel' | 'options'>[] = itemSlots(text)): ItemSet[] {
  const items = listItems(text);
  const byName = new Map(items.map((i) => [i.name, i]));
  const home = new Map<string, Pick<ItemSlot, 'slot' | 'slotLabel'>>(); // wearable id -> its slot in the builder
  for (const s of slots) for (const o of s.options) home.set(o.id, s);
  const out: ItemSet[] = [];
  for (const set of items) {
    if (set.prefab !== 'bundle' || !set.bundleItems || !set.bundleItems.length || /do not use/i.test(set.name)) continue;
    const heroes = itemHeroes(text, set);
    if (!heroes.length || hiddenItemHeroes(heroes)) continue;
    const pieces: SetPiece[] = [];
    const taken = new Set<string>();
    let collide = 0;
    for (const name of set.bundleItems) {
      const it = byName.get(name);
      if (!it || it.prefab !== 'wearable') continue; // not a hero item
      const at = home.get(it.id);
      if (at && !taken.has(at.slot)) {
        taken.add(at.slot);
        pieces.push({ name: toUtf8(it.name), itemId: it.id, fits: true, slot: at.slot, slotLabel: at.slotLabel });
        continue;
      }
      if (at) collide++;
      const reason = at ? t('второй предмет на тот же слот')
        : isArcanaPersonaItem(it) ? t('аркана или персона: конструктор их не меняет')
          : t('для него нет слота в конструкторе');
      pieces.push({ name: toUtf8(it.name), itemId: it.id, fits: false, reason });
    }
    const fit = pieces.filter((p) => p.fits).length;
    if (!fit || collide > fit) continue;
    const heroIds = heroes.map(canonicalHeroId);
    out.push({
      id: set.id, name: toUtf8(set.name), heroIds, fit, pieces,
      heroLabel: heroIds.map((id) => heroDisplayName(id)).join(' / '),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
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

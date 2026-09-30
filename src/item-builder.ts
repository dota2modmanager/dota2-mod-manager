/* The item builder: a hero's stock item built from one of its wearables, with an effect on top.
 *
 * For each hero and slot the free cosmetics offer that hero's wearables. Picking one rewrites its
 * block in items_game under the stock item's id, name and prefab=default_item, drops the styles
 * and unlocks a free base item cannot use, adds the chosen particle effect to its visuals, and
 * lists the model and particles to copy out of the game's pak01 under the stock paths, so the
 * game draws the wearable where the stock item was. src/schema-service.ts applies it along with
 * the rest of the free cosmetics; src/schema.ts reads and merges the table.
 *
 * Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
 * (https://github.com/TheFleece).
 * Copyright (C) 2026 h6rd
 * Copyright (C) 2026 TheFleece
 * SPDX-License-Identifier: GPL-3.0-or-later
 * The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
 * the credits of the program it goes into.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openVpkIndex, entryAt, heroDisplayName, type VpkEntry } from './vpk.ts';
import { t } from './i18n.ts';
import {
  findItem, itemFields, listItems, toUtf8, eachChild, blockBounds, stripKeyBlocks, itemSearchText, inferredItemSlot,
  type SchemaItem,
} from './schema.ts';

/** An effect the builder can add to an item: a particle it creates. */
type ItemEffect = { id: string; name: string; type: string; modifier: string };

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

const ITEM_EFFECTS: ItemEffect[] = [
  {
    id: 'fire',
    name: 'Огонь',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_trail_lava/courier_trail_lava.vpcf',
  },
  {
    id: 'lightnings',
    name: 'Молнии',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_platinum_roshan/platinum_roshan_ambient.vpcf',
  },
  {
    id: 'frostbloom',
    name: 'Иней',
    type: 'particle_create',
    modifier: 'particles/econ/seasonal/seasonal_ambient_silver.vpcf',
  },
  {
    id: 'snow',
    name: 'Снег',
    type: 'particle_create',
    modifier: 'particles/econ/seasonal/seasonal_ambient_snow.vpcf',
  },
  
  {
    id: 'bubbles',
    name: 'Пузыри',
    type: 'particle_create',
    modifier: 'particles/econ/seasonal/seasonal_ambient_bubbles.vpcf',
  },
  {
    id: 'sand-storm',
    name: 'Песчаная буря',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_roshan_desert_sands/baby_roshan_desert_sands_ambient.vpcf',
  },
  {
    id: 'ghost',
    name: 'Призрак',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_f2p/courier_f2p_10th_anniversary_ambient.vpcf',
  },
  // {
  //   id: 'candy_caster',
  //   name: '_Candy Caster',
  //   type: 'particle_create',
  //   modifier: 'particles/econ/seasonal/seasonal_ambient_candy_mint.vpcf',
  // },
  // {
  //   id: 'coins',
  //   name: '_Coins',
  //   type: 'particle_create',
  //   modifier: 'pparticles/econ/seasonal/seasonal_ambient_fortune_coin.vpcf',
  // }
];

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

function canonicalItemSlot(slot: unknown): string {
  return String(slot || '').toLowerCase();
}

function matchItemSlot(slot: unknown): string {
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

function isArcanaPersonaItem(item: Partial<SchemaItem> | null): boolean {
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

/** The effect variants the synthetic cosmetics/items picker can apply. */
export function itemEffects(): { id: string; name: string }[] {
  return [{ id: '', name: t('Без эффекта') }, ...ITEM_EFFECTS.map(({ id, name }) => ({ id, name: t(name) }))];
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

// ---------- reading the game's own schema ----------

function setScalarField(blockText: string, key: string, value: string): string {
  const body = blockBounds(blockText, 0);
  let hit = null as { start: number; end: number } | null;
  eachChild(blockText, body, (c) => {
    if (!hit && !c.isBlock && c.key.toLowerCase() === key.toLowerCase()) hit = c;
  });
  const line = `"${key}"\t\t"${value}"`;
  if (hit) return blockText.slice(0, hit.start) + line + blockText.slice(hit.end);
  const close = blockText.lastIndexOf('}');
  return close === -1 ? blockText : `${blockText.slice(0, close)}\r\n\t${line}\r\n${blockText.slice(close)}`;
}

function setVisualsBlock(blockText: string, visuals: string): string {
  const body = blockBounds(blockText, 0);
  let hit = null as { start: number; end: number } | null;
  eachChild(blockText, body, (c) => {
    if (!hit && c.isBlock && c.key.toLowerCase() === 'visuals') hit = c;
  });
  const clean = visuals.trim();
  if (hit) return blockText.slice(0, hit.start) + clean + blockText.slice(hit.end);
  const close = blockText.lastIndexOf('}');
  return close === -1 ? blockText : `${blockText.slice(0, close)}\r\n\t${clean}\r\n${blockText.slice(close)}`;
}

function itemEffectById(effectId: unknown): ItemEffect | null {
  const want = String(effectId || '').trim().toLowerCase();
  return ITEM_EFFECTS.find((e) => e.id === want) || null;
}

/**
 * The effects of one pick as one string: ids in the order ITEM_EFFECTS lists them, each once,
 * comma separated, '' for none. A pick carries several (the window says "you can pick several"),
 * and this is how a record stores them and how two picks are told apart, so "fire,snow" and
 * "snow,fire" are the same pick.
 */
export function effectKey(effectIds: string | string[] | null | undefined): string {
  const want = new Set((Array.isArray(effectIds) ? effectIds : String(effectIds || '').split(','))
    .map((id) => String(id).trim().toLowerCase())
    .filter(Boolean));
  const known = ITEM_EFFECTS.map((e) => e.id).filter((id) => want.has(id));
  // an id nobody offers stays in, at the end, so the build can say which one it did not know
  const unknown = [...want].filter((id) => !known.includes(id)).sort();
  return [...known, ...unknown].join(',');
}

function setBlockId(blockText: string, id: string): string {
  return String(blockText).replace(/^\s*"\d+"/, `"${id}"`);
}

function itemHeroes(text: string, item: { start: number }): string[] {
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

function itemBlock(text: string, item: { start: number; end: number }): string {
  return text.slice(item.start, item.end);
}

function itemVisuals(text: string, item: { start: number }): string | null {
  let visuals = null as string | null;
  eachChild(text, blockBounds(text, item.start), (c) => {
    if (c.isBlock && c.key.toLowerCase() === 'visuals') visuals = text.slice(c.start, c.end);
  });
  return visuals;
}

function normalizeAssetPath(p: unknown): string {
  return String(p || '').toLowerCase().replace(/\\/g, '/').replace(/^\/+/, '');
}

function compiledAssetPath(p: unknown): string {
  const clean = normalizeAssetPath(p);
  return clean.endsWith('_c') ? clean : `${clean}_c`;
}

function sameHeroes(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((h, i) => h === b[i]);
}

/** The stock default_item that matches a wearable by slot and by the hero(es) that can equip it. */
export function defaultItemForWearable(text: string, sourceId: string | number): SchemaItem | null {
  const source = findItem(text, sourceId);
  if (!source) throw new Error(t('items_game: предмет {0} не найден', sourceId));
  const sourceFields = itemFields(text, source);
  const sourceLite = listItems(text).find((i) => i.id === source.id) || null;
  if (sourceLite && isArcanaPersonaItem(sourceLite)) return null;
  const sourceSlot = canonicalItemSlot(sourceFields.get('item_slot') || inferredItemSlot(sourceLite));
  if (!sourceSlot) return null;
  const sourceMatchSlot = matchItemSlot(sourceSlot);
  const sourceHeroes = itemHeroes(text, source);
  const exact = listItems(text)
    .filter((i) => i.id !== source.id && canonicalItemSlot(inferredItemSlot(i)) === sourceSlot && i.prefab === 'default_item' && !isArcanaPersonaItem(i))
    .map((i) => ({ item: i, heroes: itemHeroes(text, i) }))
    .filter((x) => sameHeroes(x.heroes, sourceHeroes))
    .map((x) => x.item)
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (exact.length) return exact[0];
  return listItems(text)
    .filter((i) => i.id !== source.id && matchItemSlot(inferredItemSlot(i)) === sourceMatchSlot && i.prefab === 'default_item' && !isArcanaPersonaItem(i))
    .map((i) => ({ item: i, heroes: itemHeroes(text, i) }))
    .filter((x) => sameHeroes(x.heroes, sourceHeroes))
    .map((x) => x.item)
    .sort((a, b) => Number(a.id) - Number(b.id))[0] || null;
}

function particleVisualCopies(visuals: string): AssetCopy[] {
  const copies: AssetCopy[] = [];
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'asset_modifier') return;
    const fields = new Map<string, string>();
    eachChild(visuals, c.body, (f) => { if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value); });
    if ((fields.get('type') || '').toLowerCase() !== 'particle') return;
    const asset = fields.get('asset');
    const modifier = fields.get('modifier');
    if (!asset || !modifier) return;
    copies.push({ from: modifier, to: asset });
  });
  return copies;
}

function appendItemEffect(visuals: string, effect: ItemEffect): string {
  const needle = String(effect.modifier || '').toLowerCase();
  if (needle && visuals.toLowerCase().includes(needle)) return visuals;
  const block = `"asset_modifier"\r\n{\r\n\t"type"\t\t"${effect.type}"\r\n\t"modifier"\t\t"${effect.modifier}"\r\n}`;
  // set from inside the walk, which is why they are widened by hand
  let after = null as number | null;
  let before = null as number | null;
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'asset_modifier') return;
    const fields = new Map<string, string>();
    eachChild(visuals, c.body, (f) => { if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value); });
    const type = (fields.get('type') || '').toLowerCase();
    if (type === 'particle_create') after = c.end;
    else if (after !== null && before === null) before = c.start;
  });
  const close = visuals.lastIndexOf('}');
  const at = before ?? after ?? close;
  if (at === -1) return visuals;
  const prefix = '\r\n\t';
  const suffix = before === null ? '\r\n' : '\r\n\t';
  return `${visuals.slice(0, at)}${prefix}${block}${suffix}${visuals.slice(at)}`;
}

/* Turn one paid wearable into the hero's stock item for that slot.
 *
 * The block stays the donor item almost verbatim: only the header is rewritten to the matching
 * default_item (id + name + prefab), styles/unlocks that cannot be used on a free base item are
 * dropped, and the chosen effect is inserted into visuals. The donor model/particles stay named
 * as the paid item in items_game, while assetCopies still describe the stock-path overrides the
 * built VPK should carry.
 */
export function itemEffectPatch(baseText: string, itemId: string | number, effectIds: string | string[] | null | undefined): { id: string; block: string; assetCopies: AssetCopy[] } {
  const source = findItem(baseText, itemId);
  if (!source) throw new Error(t('items_game: предмет {0} не найден', itemId));
  const target = defaultItemForWearable(baseText, itemId);
  if (!target) throw new Error(t('items_game: default_item для предмета {0} не найден', itemId));
  // several at once: the window offers them that way, and one unknown id refuses the whole pick
  const effects = effectKey(effectIds).split(',').filter(Boolean).map((id) => {
    const effect = itemEffectById(id);
    if (!effect) throw new Error(t('items_game: эффект {0} не найден', id));
    return effect;
  });

  const sourceFields = itemFields(baseText, source);
  const targetFields = itemFields(baseText, target);
  let visuals = itemVisuals(baseText, source) || '"visuals"\r\n{\r\n}';

  const assetCopies: AssetCopy[] = [];
  const sourceModel = sourceFields.get('model_player') || '';
  const targetModel = targetFields.get('model_player') || '';
  if (sourceModel && targetModel && normalizeAssetPath(sourceModel) !== normalizeAssetPath(targetModel)) {
    assetCopies.push({ from: sourceModel, to: targetModel });
  }
  assetCopies.push(...particleVisualCopies(visuals));

  visuals = stripKeyBlocks(visuals, 'unlock');
  visuals = stripKeyBlocks(visuals, 'styles');
  for (const effect of effects) visuals = appendItemEffect(visuals, effect);

  let patched = setBlockId(itemBlock(baseText, source), target.id);
  patched = setScalarField(patched, 'name', targetFields.get('name') || target.name || target.id);
  patched = setScalarField(patched, 'prefab', 'default_item');
  patched = setVisualsBlock(patched, visuals);
  return { id: target.id, block: patched, assetCopies };
}

/** Read compiled asset bytes out of pak01 and stage them under the renamed path in our VPK. */
export function gameAssetEntries(gamePath: string, assetCopies: AssetCopy[] | null | undefined): VpkEntry[] {
  const pak = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  if (!fs.existsSync(pak)) throw new Error(t('Не найден {0}', pak));
  const ix = openVpkIndex(pak);
  const out: VpkEntry[] = [];
  const seen = new Set<string>();
  for (const copy of assetCopies || []) {
    const from = compiledAssetPath(copy.from);
    const to = compiledAssetPath(copy.to);
    if (!from || !to || seen.has(to)) continue;
    const data = ix.read(from);
    if (!data) throw new Error(t('Не найден {0}', from));
    out.push(entryAt(to, data));
    seen.add(to);
  }
  return out;
}


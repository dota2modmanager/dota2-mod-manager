/* The item builder's sets: what a set of the game's puts on, and what the game says about it
 * (rarity, release date, event). Out of src/item-builder-slots.ts when that file reached its
 * budget; callers import it through src/item-builder.ts.
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
import { listItems, toUtf8, eachChild, blockBounds } from './schema.ts';
import { canonicalHeroId, isPersonaItem, itemHeroes, itemSlots, type ItemSlot } from './item-builder-slots.ts';
import { itemFacts } from './item-builder-details.ts';

/** One piece of a set: where it goes, or why it does not. `styles`: how many looks the piece has, when more than one. */
type SetPiece =
  | { name: string; itemId: string; fits: true; slot: string; slotLabel: string; styles?: number; rarity?: string }
  | { name: string; itemId: string; fits: false; reason: string };

/**
 * A set, as the builder puts it on; see itemSets. What the game says about it comes as it is in
 * the table: `rarity` a key of its "rarities" ("mythical"), `date` as "2021-08-18", `event` an
 * event id ("EVENT_ID_FALL_2021"), and the name and description as localization tokens. `styles`
 * is the most looks any of its pieces has, 1 for none.
 */
export interface ItemSet {
  id: string; name: string; heroIds: string[]; fit: number; heroLabel: string; pieces: SetPiece[];
  rarity: string; date: string; event: string; nameToken: string; descToken: string; styles: number;
}

/** The plain values right under an item's block, by lower-case key. */
function topValues(text: string, item: { start: number }): Map<string, string> {
  const out = new Map<string, string>();
  eachChild(text, blockBounds(text, item.start), (c) => { if (!c.isBlock) out.set(c.key.toLowerCase(), String(c.value ?? '')); });
  return out;
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
 * item the builder leaves alone (a persona) is listed as not fitting, with why: it
 * is part of what the set looks like. A set with nothing to put on is left out, and so is a store
 * bundle of several sets ("Bounty Hunter's Big Bundle": 22 items, 7 slots): more of its pieces
 * want a taken slot than fit, and the first of each would dress the hero in a mix of sets that
 * are each listed on their own anyway. Valve's "DO NOT USE" is left out as well.
 * @param text  items_game
 * @param slots  itemSlots(text), when the caller has it already
 */
export function itemSets(text: string, slots: Pick<ItemSlot, 'slot' | 'slotLabel' | 'options' | 'persona' | 'abilityFx'>[] = itemSlots(text)): ItemSet[] {
  const items = listItems(text);
  const byName = new Map(items.map((i) => [i.name, i]));
  const home = new Map<string, Pick<ItemSlot, 'slot' | 'slotLabel'>>(); // wearable id -> its slot in the builder
  const looks = new Map<string, number>(); // wearable id -> how many styles it has
  for (const s of slots) {
    // a set's item is worn in its own slot; in an ability effects slot it would bring its effects alone
    if (s.persona || s.abilityFx) continue;
    for (const o of s.options) {
      home.set(o.id, s);
      if (o.styles && o.styles.length > 1) looks.set(o.id, o.styles.length);
    }
  }
  const out: ItemSet[] = [];
  for (const set of items) {
    if (set.prefab !== 'bundle' || !set.bundleItems || !set.bundleItems.length || /do not use/i.test(set.name)) continue;
    const heroes = itemHeroes(text, set);
    if (!heroes.length) continue;
    const pieces: SetPiece[] = [];
    const taken = new Set<string>();
    let collide = 0;
    for (const name of set.bundleItems) {
      const it = byName.get(name);
      if (!it || it.prefab !== 'wearable') continue; // not a hero item
      const at = home.get(it.id);
      if (at && !taken.has(at.slot)) {
        taken.add(at.slot);
        const styles = looks.get(it.id);
        const { rarity } = itemFacts(text.slice(it.start, it.end));
        pieces.push({ name: toUtf8(it.name), itemId: it.id, fits: true, slot: at.slot, slotLabel: at.slotLabel, ...(styles ? { styles } : {}), ...(rarity ? { rarity } : {}) });
        continue;
      }
      if (at) collide++;
      const reason = at ? t('второй предмет на тот же слот')
        : isPersonaItem(it) ? t('персона: конструктор их не меняет')
          : t('для него нет слота в конструкторе');
      pieces.push({ name: toUtf8(it.name), itemId: it.id, fits: false, reason });
    }
    const fit = pieces.filter((p) => p.fits).length;
    if (!fit || collide > fit) continue;
    const heroIds = heroes.map(canonicalHeroId);
    const v = topValues(text, set);
    out.push({
      id: set.id, name: toUtf8(set.name), heroIds, fit, pieces,
      heroLabel: heroIds.map((id) => heroDisplayName(id)).join(' / '),
      rarity: (v.get('item_rarity') || '').toLowerCase(),
      date: /^\d{4}-\d{2}-\d{2}/.test(v.get('creation_date') || '') ? (v.get('creation_date') as string).slice(0, 10) : '',
      event: v.get('event_id') || '',
      nameToken: set.itemName || '',
      descToken: set.itemDescription || '',
      styles: Math.max(1, ...pieces.map((p) => (p.fits && p.styles) || 1)),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

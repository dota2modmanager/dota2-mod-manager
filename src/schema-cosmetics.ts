// The free cosmetics (src/schema-service.ts): the slots the game has a free base item for and what
// can go on each, the look picked for one, a whole set put on at once, and the one-time move of
// picks that used to live in settings.json. A pick is a library record like any other mod.
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema.ts';
import * as itemBuilder from './item-builder.ts';
import { t } from './i18n.ts';
import { getLang } from './i18n.ts';
import { chineseCosmeticNamesSteps, styleNamer } from './cosmetic-names.ts';
import { sharedVpkIndexSteps } from './vpk.ts';
import { drain, PAUSE } from './steps.ts';
import type { Settings } from './settings.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';
import type { ItemSet } from './item-builder.ts';

/** What the window is told about the free looks and the item builder (cosmeticSlots). */
export type CosmeticSlots = { slots: CosmeticSlot[]; sets: ItemSet[]; names?: Record<string, string>; error?: string };

/** A slot the free-cosmetics picker offers: its base item, what is on it, and what could be. */
export type CosmeticSlot = {
  slot: string; base: string; picked: string | null | undefined; recordId: string | null;
  options: { id: string; name: string }[]; [key: string]: unknown;
};

/** Picks and the slots they go in, over the library, the game's table and the service's rebuild. */
export function createCosmetics({ library, settings, gamePath, vanilla, refresh }: {
  library: Library; settings: Pick<Settings, 'get' | 'set'>;
  gamePath: () => string | null; vanilla: () => string; refresh: () => unknown;
}) {
  // The live cosmetic record for a slot, if any — at most one is ever enabled at a time
  // (see pickCosmetic), the same rule the app already applies to cursor sets.
  function cosmeticRecordFor(slot: string): LibRecord | null {
    return library.list().find((r) => r.categoryId === 'cosmetic' && r.slot === slot && r.enabled !== false) || null;
  }

  /**
   * Every slot that has both a free "base item" and something to put on it, in one call.
   * The list comes from the installed game, so a slot Valve adds later appears by itself.
   * With them, the item builder's sets (item-builder.js itemSets).
   */
  function cosmeticSlots(): CosmeticSlots {
    return drain(cosmeticSlotsSteps());
  }

  /**
   * cosmeticSlots, a pause at a time: the window asks for it on every start, and on the first one
   * it is most of a second of walking the game's table and opening its index, which held the
   * catalog back and the window with it (src/ipc-game.ts runs it a step at a time).
   */
  function* cosmeticSlotsSteps(): Generator<typeof PAUSE, CosmeticSlots> {
    const game = gamePath();
    if (!game) return { slots: [], sets: [] };
    try {
      const text = vanilla();
      yield PAUSE;
      const bases = (yield* schema.listItemsSteps(text)).filter((i) => i.baseitem);
      const seen = new Set<string>();
      const slots: CosmeticSlot[] = [];
      for (const base of bases) {
        const slot = base.slot || base.prefab || '';
        if (!slot || seen.has(slot)) continue;
        seen.add(slot);
        yield PAUSE; // each slot is a pass over the 26 000 items
        const options = schema.cosmeticOptions(text, slot);
        if (!options.length) continue;
        const rec = cosmeticRecordFor(slot);
        slots.push({ slot, base: base.id, picked: rec ? rec.itemId : null, recordId: rec ? rec.id : null, options });
      }
      yield PAUSE;
      const itemSlots = yield* itemBuilder.itemSlotsSteps(text);
      yield PAUSE;
      const sets = itemBuilder.itemSets(text, itemSlots);
      yield PAUSE;
      const effects = itemBuilder.itemEffects();
      if (itemSlots.length && effects.length) {
        // the style names are read out of the game's index: opened here a pause at a time
        const pak = path.join(game, 'dota', 'pak01_dir.vpk');
        if (fs.existsSync(pak)) yield* sharedVpkIndexSteps(pak);
        const styleName = styleNamer(game, getLang(), (i) => t('Стиль {0}', i + 1));
        const entries = itemSlots.map((it) => {
          const rec = cosmeticRecordFor(it.slot);
          return {
            ...it,
            options: it.options.map((o) => (o.styles ? { ...o, styles: o.styles.map(styleName) } : o)),
            picked: rec ? rec.itemId : null,
            pickedEffect: rec ? (rec.effectId || '') : '',
            recordId: rec ? rec.id : null,
            effects,
          };
        });
        const at = slots.findIndex((s) => s.slot === 'weather');
        if (at === -1) slots.unshift(...entries);
        else slots.splice(at + 1, 0, ...entries);
      }
      if (getLang() !== 'zh-CN') return { slots, sets };
      yield PAUSE;
      return { slots, sets, names: yield* chineseCosmeticNamesSteps(game, text) };
    } catch (err) {
      return { slots: [], sets: [], error: String((err as Error)?.message || err) };
    }
  }

  /**
   * Pick a look for a slot. Switching to a genuinely new item disables whatever was live for
   * that slot (never deletes it: a preset saved earlier may still point at that record,
   * exactly like disabling a regular mod doesn't erase it) and creates a fresh record — or
   * reactivates a dormant one for that same item, so flipping back and forth between two
   * looks doesn't spawn a new row each time. Returns the now-live record. `write: false` leaves
   * the game alone, for a caller that picks several and writes once (pickSet).
   */
  function pickCosmetic(slot: string, itemId: string | number, itemName: string | null | undefined, effectId: string | string[] | null | undefined = null, { write = true } = {}): LibRecord | null {
    const id = String(itemId);
    const name = itemName || id;
    const isItem = slot === 'items' || String(slot || '').startsWith('item:');
    // the item builder's effects, as one string in one order (item-builder.js effectKey)
    const effect = isItem ? itemBuilder.effectKey(effectId) : '';
    const live = cosmeticRecordFor(slot);
    if (live && live.itemId === id && itemBuilder.effectKey(live.effectId) === effect) return live; // already this

    // Other effects on the same item are that pick changed, not another pick. Each combination
    // used to become a record of its own, and My mods filled with rows of one item's name that
    // told nobody which was which. One row per item, its effects a property of it.
    if (isItem && live && live.itemId === id) {
      library.update(live.id, { name, effectId: effect || undefined });
      if (write) refresh();
      return library.find(live.id);
    }

    if (live) library.setEnabled(live.id, false);
    const dormant = library.list().find((r) => r.categoryId === 'cosmetic'
      && r.slot === slot && r.itemId === id && (isItem || itemBuilder.effectKey(r.effectId) === effect));
    // a record found a line above updates, so there is always one here
    const rec = (dormant
      ? library.update(dormant.id, { name, enabled: true, effectId: effect || undefined })
      : library.add({ name, categoryId: 'cosmetic', styleLabel: null, fileRef: null, preview: null, files: [] })) as LibRecord;
    if (!dormant) library.update(rec.id, { slot, itemId: id, ...(effect ? { effectId: effect } : {}) });
    if (write) refresh();
    return library.find(rec.id);
  }

  /**
   * Put a whole set on: each piece the builder has a slot for takes that slot, a row of its own
   * in My mods, and the game is written once. A set brings no effects, and a piece that is on
   * already keeps the ones it has. With write false the writing is the caller's, which builds in
   * the background (src/ipc-game.ts).
   */
  function pickSet(setId: string | number, { write = true } = {}): { applied: number; pieces: number } {
    const set = itemBuilder.itemSets(vanilla()).find((x) => x.id === String(setId));
    if (!set) throw new Error(t('Набор не найден'));
    let applied = 0;
    for (const p of set.pieces) {
      if (!p.fits || !p.slot) continue;
      const live = cosmeticRecordFor(p.slot);
      pickCosmetic(p.slot, p.itemId, p.name, live && live.itemId === p.itemId ? live.effectId : '', { write: false });
      applied++;
    }
    if (write) refresh();
    return { applied, pieces: set.pieces.length };
  }

  // One-time move of picks that used to live in settings.json into library records, from
  // before cosmetics could be toggled/deleted/shared like any other mod.
  function migrateCosmeticSettings() {
    const picks = settings.get('cosmetics');
    if (!picks || !Object.keys(picks).length) return;
    const game = gamePath();
    if (!game) return;
    try {
      const text = vanilla();
      for (const [slot, itemId] of Object.entries(picks)) {
        if (!itemId || cosmeticRecordFor(slot)) continue;
        const opt = schema.cosmeticOptions(text, slot).find((o) => o.id === String(itemId));
        pickCosmetic(slot, String(itemId), opt ? opt.name : slot);
      }
    } catch { /* the game path may not be ready yet; nothing lost, just retried next start */ }
    settings.set('cosmetics', {});
  }

  return { cosmeticSlots, cosmeticSlotsSteps, pickCosmetic, pickSet, migrateCosmeticSettings };
}

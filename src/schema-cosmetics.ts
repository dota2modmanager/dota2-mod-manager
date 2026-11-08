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
import { heroAttributesSteps, setDetails, type HeroAttribute, type SetDetails } from './item-builder-details.ts';
import { drain, PAUSE } from './steps.ts';
import type { Settings } from './settings.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';
import type { ItemSet } from './item-builder.ts';
import { displaced, isSelectorSlot } from './item-builder-personas.ts';
import { offeredUnusual } from './item-builder-unusual.ts';
import { offeredKinetic } from './item-builder-kinetic.ts';
import { fxSlotOf, namedFxSlots } from './item-builder-ability-fx.ts';

/** What the window is told about the free looks and the item builder (cosmeticSlots). */
/** `heroAttrs`: each hero's main attribute by its id without the prefix, for the order of the game's hero grid. */
export type CosmeticSlots = {
  slots: CosmeticSlot[]; sets: (ItemSet | SetDetails)[]; heroAttrs?: Record<string, HeroAttribute>; names?: Record<string, string>; error?: string;
};

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
      // the banner and the Tormentor have no free item: the picked one becomes it (schema.OWNERLESS_SLOTS)
      for (const slot of schema.OWNERLESS_SLOTS) {
        if (seen.has(slot)) continue;
        const options = schema.cosmeticOptions(text, slot);
        if (!options.length) continue;
        const rec = cosmeticRecordFor(slot);
        slots.push({ slot, base: '', picked: rec ? rec.itemId : null, recordId: rec ? rec.id : null, options });
      }
      yield PAUSE;
      // the style and ability names are read out of the game's index: opened here a pause at a time
      const pak = path.join(game, 'dota', 'pak01_dir.vpk');
      const ix = fs.existsSync(pak) ? yield* sharedVpkIndexSteps(pak) : null;
      // an ability effects slot by its ability's name, and none the hero has not got (src/item-builder-ability-fx.ts)
      const listed = yield* itemBuilder.itemSlotsSteps(text);
      const itemSlots = ix ? namedFxSlots(listed, (p) => ix.read(p), getLang()) : listed;
      yield PAUSE;
      let sets: (ItemSet | SetDetails)[] = itemBuilder.itemSets(text, itemSlots);
      let heroAttrs: Record<string, HeroAttribute> = {};
      yield PAUSE;
      const effects = itemBuilder.itemEffects();
      if (itemSlots.length && effects.length) {
        if (ix) heroAttrs = yield* heroAttributesSteps(ix, itemSlots.flatMap((it) => it.heroIds));
        const styleName = styleNamer(game, getLang(), (i) => t('Стиль {0}', i + 1));
        yield PAUSE;
        // the game's own unusual effects after the builder's, by the names the game gives them (issue #393)
        const gameName = styleNamer(game, getLang(), () => '');
        // effects by their English names in every language: players look them up as "Ethereal Flame"
        const english = styleNamer(game, 'en', () => '');
        const offered = [...effects, ...offeredUnusual(text, (id) => !!english(`#Attrib_Particle${id}`, 0))
          .map((e) => ({ id: e.id, name: english(e.nameToken, 0) }))];
        const entries = itemSlots.map((it) => {
          const rec = cosmeticRecordFor(it.slot);
          return {
            ...it,
            options: it.options.map((o) => (o.styles ? { ...o, styles: o.styles.map(styleName) } : o)),
            picked: rec ? rec.itemId : null,
            pickedEffect: rec ? (rec.effectId || '') : '',
            recordId: rec ? rec.id : null,
            // a persona has no model for an effect to sit on, and an ability effects slot no model at all
            effects: (it.persona && !it.persona.part) || it.abilityFx ? [] : [...offered, ...offeredKinetic(text, it.heroIds).map((g) => ({ id: g.id, name: english(g.nameToken, 0) || g.fallback }))],
          };
        });
        const named = new Map(entries.flatMap((it) => it.options.map((o) => [o.id, o.styles] as const)));
        sets = setDetails(sets as ItemSet[], (token) => gameName(token, 0), (id) => named.get(id));
        const at = slots.findIndex((s) => s.slot === 'weather');
        if (at === -1) slots.unshift(...entries);
        else slots.splice(at + 1, 0, ...entries);
      }
      if (getLang() !== 'zh-CN') return { slots, sets, heroAttrs };
      yield PAUSE;
      return { slots, sets, heroAttrs, names: yield* chineseCosmeticNamesSteps(game, text) };
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
    // a persona is worn with its own items alone (src/item-builder-personas.ts): the hero's plain
    // picks go off, kept in My mods to be put back on
    if (isSelectorSlot(slot)) for (const r of displaced(library.list())) library.setEnabled(r.id, false);
    if (write) refresh();
    return library.find(rec.id);
  }

  /**
   * Put a whole set on: each piece the builder has a slot for takes that slot, a row of its own
   * in My mods, and the game is written once. A set brings no effects, and a piece that is on
   * already keeps the ones it has. With write false the writing is the caller's, which builds in
   * the background (src/ipc-game.ts).
   *
   * The set is the whole hero: every other pick of his goes off, kept in My mods to be put back
   * on. An arcana picked in his hero base before stayed on, and its base put the arcana's body
   * under the hero's own path, so Earthshaker wore the Gar Beast on Planetfall's body
   * (J0nathan550, 2026-10-31). So do a persona and its pieces, which he would wear in its place.
   *
   * `style` is the look chosen in the set's window (issue #526): a piece that has it wears it, one
   * with fewer looks wears its first.
   */
  function pickSet(setId: string | number, { write = true, style = 0 } = {}): { applied: number; pieces: number } {
    const set = itemBuilder.itemSets(vanilla()).find((x) => x.id === String(setId));
    if (!set) throw new Error(t('Набор не найден'));
    const fits = set.pieces.flatMap((p) => (p.fits && p.slot ? [p] : []));
    // a set leaves the ability effects slots as they are, as the game's loadout does
    offTheHero(`item:${set.heroIds.join('+')}:`, new Set(fits.map((p) => p.slot)), true);
    const n = Math.max(0, Math.floor(Number(style) || 0));
    for (const p of fits) {
      const live = cosmeticRecordFor(p.slot);
      const kept = live && live.itemId === p.itemId ? String(live.effectId || '').split(',').filter((id) => id && !/^style-\d+$/.test(id)) : [];
      pickCosmetic(p.slot, p.itemId, p.name, [...kept, ...(n > 0 && n < (p.styles || 1) ? [`style-${n}`] : [])], { write: false });
    }
    if (write) refresh();
    return { applied: fits.length, pieces: set.pieces.length };
  }

  /** The hero's picks off but those on the slots named, and with `keepFx` those in his ability effects slots: kept in My mods, to be put back on. */
  function offTheHero(hero: string, keep: Set<string>, keepFx = false): void {
    for (const r of library.list()) {
      if (r.categoryId === 'cosmetic' && r.enabled !== false && r.slot?.startsWith(hero) && !keep.has(r.slot) && !(keepFx && fxSlotOf(r.slot))) library.setEnabled(r.id, false);
    }
  }

  /**
   * Put a saved look on (issue #527): each of its picks goes on as the player left it, the hero's
   * other picks go off, kept in My mods, and the game is written once. A pick that is not one of
   * this hero's is skipped and counted.
   * @param hero  the prefix of the hero's slots, "item:axe:"
   */
  function wearLook(hero: string, picks: { slot: string; itemId: string; name?: string; effectId?: string }[], { write = true } = {}): { applied: number; picks: number } {
    if (!/^item:[a-z0-9_+]+:$/.test(String(hero || '')) || !Array.isArray(picks)) throw new Error(t('Образ не найден'));
    const wear = picks.filter((p) => p && typeof p.slot === 'string' && p.slot.startsWith(hero) && /^[a-z0-9_]+$/.test(p.slot.slice(hero.length)) && /^\d+$/.test(String(p.itemId)));
    offTheHero(hero, new Set(wear.map((p) => p.slot)));
    for (const p of wear) pickCosmetic(p.slot, p.itemId, p.name || p.itemId, p.effectId || '', { write: false });
    if (write) refresh();
    return { applied: wear.length, picks: picks.length };
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

  return { cosmeticSlots, cosmeticSlotsSteps, pickCosmetic, pickSet, wearLook, migrateCosmeticSettings };
}

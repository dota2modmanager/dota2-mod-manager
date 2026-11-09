/**
 * The item builder's picks as files alone: a look the game takes from a pak in the language folder,
 * with no edit of the game's own files and no line in its item table.
 *
 * A pick has always been mostly files: its model under the stock path, its particle swaps, sounds
 * and pictures (src/item-builder-assets.ts). The table's block added what a file was thought unable
 * to say. Most of that a file can say after all:
 *  - the item's `particle_create`s go into the wearable's own key values (src/model-particles.ts),
 *    with hitboxes on its surface for them to spread over (src/model-hitboxes.ts);
 *  - its material set is made the model's default (src/model-skin.ts);
 *  - its activity modifiers are taken off the hero's body, so the item's motions are the plain ones
 *    (arcana.ts asModel), one body per hero whatever the number of picks;
 *  - the hero parts it hides become the default of the model that has them (src/model-bodygroups.ts);
 *  - a second model it wears goes inside its first (src/model-merge.ts).
 *
 * What is left needs the table: `TABLE_ONLY`, and a slot with no stock model to stand in for. A pick
 * with such a part still goes in by files, and says what it lost (`left`), so the window can tell
 * and the person can allow the table. Calvin's constructor (dota-studio) showed that a whole look
 * can be files; merging items into the hero's body as it does is not done here, since a body keeps
 * one skeleton and his own notes speak of bone conflicts: a wearable stays a wearable.
 */
import path from 'node:path';
import { eachChild, blockBounds, findItem, itemFields, listItemsSteps } from './schema.ts';
import { asModel } from './arcana.ts';
import { heroModelPath, firstStyleSkin, normalizeAssetPath } from './item-builder-assets.ts';
import { itemHeroes } from './item-builder-slots.ts';
import { withParticles } from './model-particles.ts';
import { withSurfaceHitboxes } from './model-hitboxes.ts';
import { withSkin } from './model-skin.ts';
import { withBodygroups, withoutMeshes } from './model-bodygroups.ts';
import { mergedModel } from './model-merge.ts';
import { surfaceSystem } from './particle-surface.ts';
import { sharedVpkIndex, entryAt, entryPath, type VpkEntry } from './vpk.ts';
import { PAUSE } from './steps.ts';
import type { SchemaPatch } from './schema-merge.ts';

/** What of an item a file cannot say, by the type of its asset_modifier, with the word the log uses. */
const TABLE_ONLY: Record<string, string> = {
  entity_scale: 'its size',
  hero_scale: 'its size',
  custom_kill_effect: 'its kill effect',
  particle_combined: 'its paired effects',
  particle_control_point: 'its effect points',
  hex_model: 'its hex model',
  buff_modifier: 'its buff effect',
  arcana_level: 'its arcana levels',
  pet: 'its pet',
};

/** A pick built for the table, with what this needs to know of it (src/schema-build.ts). */
export interface PickPatch extends SchemaPatch {
  /** the stock path the item's model went under, null when it wears none */
  own?: string | null;
  /** the effects the person put on it, as systems */
  added?: string[];
  /** a model with no stock model to go under */
  unplaced?: boolean;
  /** an item pick, which can go as files; anything else in the list cannot */
  item?: boolean;
}

/** A choice of a body group an item makes, on the model that has the group. */
export interface BodyGroup { model: string; group: string; value: number }

/** One source and what of it stays behind without the table. */
export interface LeftBehind { source: string; what: string[] }

/** A build's files, and what of the picks they could not carry. */
export interface ItemFiles { entries: VpkEntry[]; left: LeftBehind[] }

/** The fields of each asset_modifier in an item block's visuals. */
function modifiers(block: string): Map<string, string>[] {
  const out: Map<string, string>[] = [];
  eachChild(block, blockBounds(block, 0), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'visuals') return;
    eachChild(block, c.body!, (m) => {
      if (!m.isBlock || !/^asset_modifier\d*$/i.test(m.key)) return;
      const fields = new Map<string, string>();
      eachChild(block, m.body!, (f) => { if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value); });
      const style = fields.get('style');
      if (!style || style === '0') out.push(fields);
    });
  });
  return out;
}

const ofType = (mods: Map<string, string>[], type: string) => mods.filter((f) => (f.get('type') || '').toLowerCase() === type);

/** The visuals block alone, which firstStyleSkin walks from its first brace. */
function visualsOf(block: string): string {
  let out = '';
  eachChild(block, blockBounds(block, 0), (c) => { if (c.isBlock && c.key.toLowerCase() === 'visuals') out = block.slice(c.start, c.end); });
  return out;
}

/** The set a pick wears its model in, 0 for the first. */
function skinOf(block: string, mods: Map<string, string>[]): number {
  const visuals = visualsOf(block);
  return Number(ofType(mods, 'model_skin')[0]?.get('skin') ?? (visuals && firstStyleSkin(visuals))) || 0;
}

/**
 * What a pick's block asks of its files: its effects, material set and motions, and what it asks
 * that a file cannot say.
 */
export function pickParts(patch: Pick<PickPatch, 'block' | 'own' | 'unplaced'>): { systems: string[]; skin: number; motions: string[]; groups: BodyGroup[]; extras: string[]; left: string[] } {
  const mods = modifiers(patch.block);
  const words = (type: string) => [...new Set(ofType(mods, type).map((f) => f.get('modifier') || '').filter(Boolean))];
  // not an effect the item's showcase alone has (spawn_in_loadout_only, 101 in the game): written into
  // the model it plays in the match too, and the young Invoker's three showcase orbs hung where he spawned
  const systems = [...new Set(ofType(mods, 'particle_create').filter((f) => f.get('spawn_in_loadout_only') !== '1').map((f) => f.get('modifier') || '').filter(Boolean))];
  const left = [...new Set(mods.flatMap((f) => TABLE_ONLY[(f.get('type') || '').toLowerCase()] ?? []))];
  if (patch.unplaced) left.push('its model');
  if (systems.length && !patch.own) left.push('its effect');
  const groups = ofType(mods, 'bodygroup_visibility').flatMap((f) => (f.get('asset') && f.get('modifier') ? [{ model: normalizeAssetPath(f.get('asset')), group: (f.get('modifier') as string).toLowerCase(), value: Number(f.get('value')) || 0 }] : []));
  return { systems, skin: skinOf(patch.block, mods), motions: words('activity'), groups, extras: extrasOf(patch.block), left };
}

/** The second models of a block, as paths. */
function extrasOf(block: string): string[] {
  return [...new Set(ofType(modifiers(block), 'additional_wearable').flatMap((f) => (f.get('asset') ? [normalizeAssetPath(f.get('asset'))] : [])))];
}

/**
 * Where a pick's second models go. The stock item's second model stays in the game's table, so the
 * game makes it for a pick that goes as files: the pick's own takes its path, and with none left
 * that path goes empty. A second model the stock item has no path for rides inside the first.
 * @param stock  the stock item's second models
 * @param extras  the pick's
 */
export function extraPlaces(stock: string[], extras: string[]): { under: { path: string; model: string | null }[]; merged: string[] } {
  const merged = extras.filter((x) => !stock.includes(x));
  const under = stock.filter((s) => !extras.includes(s)).map((path) => ({ path, model: merged.shift() ?? null }));
  return { under, merged };
}

/** A wearable as it goes in: in its material set, carrying its effects. Null: the file stays as it was. */
export function wornModel(model: Buffer, skin: number, systems: string[]): Buffer | null {
  const out = skin ? withSkin(model, skin) : model;
  if (!out || !systems.length) return out;
  // no boxes (a model this cannot read) leaves the effect at the model's origin, which is still the effect
  return withParticles(withSurfaceHitboxes(out) ?? out, systems);
}

/**
 * The list a table build made, as one pak's files.
 * @param game  the game folder, for models the pick did not already copy
 * @param beneath  files that go in after the picks' (the arcana bases)
 */
export function* itemFilesSteps(list: PickPatch[], beneath: VpkEntry[], game: string, shared?: { paths: string[]; entries: VpkEntry[] }): Generator<typeof PAUSE, ItemFiles> {
  const index = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
  const read = (p: string) => index.read(p);
  const entries = new Map<string, VpkEntry>();
  const left: LeftBehind[] = [];
  const bodies = new Map<string, string[]>();
  const hidden = new Map<string, Map<string, number>>();
  let table: string | undefined;
  // the sprite sheet, portraits and soundevents of the item picks alone, in place of the table's
  // copy, which a persona's minimap icon and lines are in too (src/schema-build.ts sharedFiles)
  const own = new Set(shared?.paths);
  for (const e of shared?.entries ?? []) entries.set(entryPath(e).toLowerCase(), e);
  for (const patch of list) {
    const source = patch.source || String(patch.id);
    // a persona, worn through the table; what is not a pick at all, a mod's block, the caller counts itself
    if (!patch.item) { if (patch.own !== undefined) left.push({ source, what: ['its persona'] }); continue; }
    const { systems, skin, motions, groups, extras, left: what } = pickParts(patch);
    for (const e of patch.assets || []) if (!own.has(entryPath(e).toLowerCase()) && !entries.has(entryPath(e).toLowerCase())) entries.set(entryPath(e).toLowerCase(), e);
    if (patch.own && (systems.length || skin)) {
      const at = patch.own.toLowerCase();
      const entry = entries.get(at);
      // an effect the person added spreads over the item; the item's own was made for it
      const added = new Set((patch.added ?? []).map((s) => s.toLowerCase()));
      const worn = entry && wornModel(entry.data, skin, systems.map((s) => {
        const copy = added.has(s.toLowerCase()) ? surfaceSystem(read, s) : null;
        for (const e of copy?.entries ?? []) entries.set(entryPath(e).toLowerCase(), e);
        return copy?.root ?? s;
      }));
      if (worn) entries.set(at, entryAt(entryPath(entry), worn));
      else if (systems.length) what.push('its effect');
      yield PAUSE;
    }
    if (patch.own && table === undefined) {
      table = (read('scripts/items/items_game.txt') as Buffer).toString('utf8');
      yield* listItemsSteps(table);
    }
    const stockItem = patch.own && table ? findItem(table, patch.id) : null;
    const { under, merged } = extraPlaces(stockItem ? extrasOf(stockItem.text) : [], extras);
    for (const u of under) {
      const at = `${u.path.replace(/_c$/, '')}_c`.toLowerCase();
      const file = read(u.model ? `${u.model.replace(/_c$/, '')}_c` : at);
      const put = file && (u.model ? file : withoutMeshes(file));
      if (put) entries.set(at, entryAt(at, put));
      else what.push('a second model');
      yield PAUSE;
    }
    if (merged.length) {
      const at = patch.own?.toLowerCase();
      const entry = at ? entries.get(at) : null;
      for (const extra of merged) {
        const second = read(`${extra.replace(/_c$/, '')}_c`);
        const current = at ? entries.get(at) : null;
        let joined: Buffer | null = null;
        try { joined = current && second ? mergedModel(current.data, second) : null; } catch { /* a model this cannot read stays out, and the window says so */ }
        if (joined && at && entry) entries.set(at, entryAt(entryPath(entry), joined));
        else what.push('a second model');
      }
      yield PAUSE;
    }
    if (motions.length) {
      for (const hero of itemHeroes(patch.block, { start: 0 })) bodies.set(hero, [...new Set([...(bodies.get(hero) ?? []), ...motions])]);
    }
    if (groups.length) {
      const mine = normalizeAssetPath(itemFields(patch.block, { start: 0 }).get('model_player'));
      for (const g of groups) {
        // the item's own model goes under its stock path; a hero's body, or the one an arcana gives, stays where it is
        const at = `${(g.model === mine && patch.own ? patch.own : g.model).toLowerCase().replace(/_c$/, '')}_c`;
        hidden.set(at, (hidden.get(at) ?? new Map()).set(g.group, g.value));
      }
    }
    if (what.length) left.push({ source, what });
  }
  // a body or a model the picks did not bring is the arcana base's where it has one, then the game's:
  // read from the game first, Terrorblade's motions went onto his plain body, which then kept the base out
  const under = new Map(beneath.map((e) => [entryPath(e).toLowerCase(), e.data]));
  const current = (at: string) => entries.get(at)?.data ?? under.get(at) ?? read(at);
  for (const [hero, motions] of bodies) {
    const at = `${heroModelPath(index, hero)}_c`.toLowerCase().replace(/_c_c$/, '_c');
    const body = current(at);
    if (!body) continue;
    try {
      entries.set(at, entryAt(at, motions.reduce((model, modifier) => asModel(model, modifier), body)));
    } catch {
      left.push({ source: hero, what: ['its motions'] });
    }
    yield PAUSE;
  }
  for (const [at, groups] of hidden) {
    const model = current(at);
    const shown = model && withBodygroups(model, groups);
    if (shown) entries.set(at, entryAt(at, shown));
    else left.push({ source: at, what: ['the hero parts it hides'] });
    yield PAUSE;
  }
  for (const e of beneath) if (!entries.has(entryPath(e).toLowerCase())) entries.set(entryPath(e).toLowerCase(), e);
  return { entries: [...entries.values()], left };
}

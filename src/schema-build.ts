/* Building the item table (src/schema-service.ts is the door: what goes into the table, when it is
 * written, how a game update is repaired). Two things live here.
 *
 * Each pick of the item builder, built once and kept. The table is built again on every pick,
 * switch and removal, and it used to build every pick over again: on the real game the thirtieth
 * pick cost thirty, 12 s, and thirty picks put on one at a time cost three minutes. A pick is now
 * built once, by item and effects, for as long as the game's table and the app's code are the ones
 * it was built from; the sounds and portraits, made from all the picks at once, are kept for as
 * long as the picks ask for the same ones.
 *
 * A build a step at a time, in the background. The steps are a generator (one per pick built
 * anew, then the merge, the check and the pak), so the same code runs all at once for a caller
 * that needs the table written before it returns, and with the rest of the main process let run
 * between the steps for one that does not: the window's other requests, the bar at the bottom,
 * and the Play button, which waits for the last build before the game starts.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import * as schema from './schema.ts';
import * as itemBuilder from './item-builder.ts';
import { listItemsSteps } from './schema-items.ts';
import { soundEntriesSteps, type SoundSwap, type VoiceCue } from './item-sounds.ts';
import { portraitEntries } from './item-portraits.ts';
import { summonModels, type ItemAssets, type PortraitSwap, type SpriteSwap } from './item-builder-assets.ts';
import { styleOf } from './item-builder-styles.ts';
import { basesHereSteps, withoutBaseFiles, type ReadyBase } from './arcana-bases.ts';
import { ownModelsWin, pickModels, refitsOf, type PickModels } from './item-builder-refits.ts';
import { isSelectorSlot, leftOut, personaAssets, personaRecords, personaScaleOf, personaScales, personasOn, type BuildRecord } from './item-builder-personas.ts';
import { scaledModels } from './model-scale.ts';
import { createColoredBases, windowColor } from './arcana-base-color.ts';
import { lookPatch } from './courier-models.ts';
import { fxSlotOf, mergeFxPatches } from './item-builder-ability-fx.ts';
import { abilityFxPatch } from './item-builder-fx-patch.ts';
import { kineticEntries } from './item-builder-kinetic.ts';
import type { BaseStore } from './arcana-base-store.ts';
import { entryPath, sharedVpkIndex, sharedVpkIndexSteps, type VpkEntry } from './vpk.ts';
import { PAUSE } from './steps.ts';
import type { LibRecord } from './types.ts';
import type { Library } from './library.ts';

/** A pick of the item builder as built: its block, and the game's files under the plain paths. */
type ItemPick = { id: string; block: string; own: string | null; added: string[]; unplaced: boolean; kinetic?: string[]; heroes?: string[]; assets: VpkEntry[] } & ItemAssets;

/** How far a build is: the picks built anew so far out of those it has to, or the stage of the write. */
export type BuildStep = { done: number; total: number } | { stage: 'merged' | 'checked' | 'packed' };
export { buildBar } from './build-bar.ts';
export { createBackgroundBuilds } from './background-builds.ts';

/** What a build yields: a step the bar counts, a pause in a long walk, or the pak to write (schema.deploySteps). */
export type BuildYield = BuildStep | schema.DeployStep;

/** What a build of the table answers. */
export interface Refreshed {
  ok: boolean;
  reason?: string;
  error?: string;
  deployed?: boolean;
  patches?: number;
  missing?: string[];
  conflicts?: schema.MergeResult['conflicts'];
  bytes?: number;
  /** stopped before it wrote, for a newer build that did */
  superseded?: boolean;
  /** stopped before it wrote, by the Cancel button on the bar (src/build-undo.ts) */
  cancelled?: boolean;
}


/** Which files a base fills, as a short name: a new version of a base builds its own parts again. */
const signatures = new WeakMap<ReadyBase, string>();
function baseSignature(r: ReadyBase): string {
  let sig = signatures.get(r);
  if (!sig) {
    sig = crypto.createHash('sha1').update([...r.paths].sort().join('\n')).digest('hex').slice(0, 10);
    signatures.set(r, sig);
  }
  return sig;
}

export const isItemPick = (rec: LibRecord) => rec.categoryId === 'cosmetic' && (rec.slot === 'items' || String(rec.slot || '').startsWith('item:'));

/** The shared files as the picks' pak takes them: `paths` the ones the table's copy carries, `entries` the pak's own, made of the item picks alone. */
export interface FilesShared { paths: string[]; entries: VpkEntry[] }

/** What goes into the table: every enabled record's patches, each item builder pick built once. */
export function createTableBuild({ library, bases, log }: {
  library: Pick<Library, 'list'>; bases?: Pick<BaseStore, 'entries' | 'want'>; log: (msg: string) => void;
}) {
  const built = new Map<string, ItemPick>();
  const shared = new Map<string, { key: string; entries: VpkEntry[] }>();
  let builtFrom: string | null = null;
  let builtGame: string | null = null;
  const colored = createColoredBases(log);
  /* A pick by item and effects, and by the base of its own arcana set when one is here: that base
   * fills some of the pick's paths, which the pick then does not build (gameAssetEntries skip). */
  const ownBase = (rec: LibRecord, ready: ReadyBase[]) => ready.find((r) => r.base.parts.includes(String(rec.itemId)));
  // and by the refit another pick makes of its model (src/item-builder-refits.ts)
  // and by how much bigger a persona's body makes its models (src/model-scale.ts)
  const pickKey = (rec: BuildRecord, ready: ReadyBase[], refit?: string, scale?: number) => {
    const own = ownBase(rec, ready);
    const fx = fxSlotOf(rec.slot);
    return `${rec.itemId}|${itemBuilder.effectKey(rec.effectId)}${fx ? `#fx${fx}` : ''}${own ? `|${own.base.id}:${baseSignature(own)}` : ''}${rec.persona ? `@${rec.persona.target}` : ''}${refit ? `~${refit}` : ''}${scale ? `*${scale}` : ''}`;
  };
  function builtPick(vanillaText: string, game: string, key: string, rec: BuildRecord, own: ReadyBase | undefined, refit: string | undefined, scale?: number): ItemPick {
    let pick = built.get(key);
    if (!pick) {
      // a summon's plain model, from the game's unit scripts: read only for an item that swaps one
      const summon: itemBuilder.SummonModels = (...args) => summonModels(sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk')))(...args);
      // in an ability effects slot the item gives its effects for that ability and no model (src/item-builder-ability-fx.ts)
      const fx = fxSlotOf(rec.slot);
      const made = fx ? abilityFxPatch(vanillaText, String(rec.itemId), rec.effectId, fx, summon)
        : itemBuilder.itemEffectPatch(vanillaText, String(rec.itemId), rec.effectId, rec.persona?.target, summon, refit);
      pick = { ...made, assets: scaledModels(itemBuilder.gameAssetEntries(game, made.assetCopies, own && ((p) => own.paths.has(p))), scale,
        (p, why) => log(`schema: ${rec.name}: ${p} left at its own size: ${why}`)) };
      built.set(key, pick);
    }
    return pick;
  }
  function* sharedEntries(name: string, inputs: unknown, make: () => Generator<typeof PAUSE, VpkEntry[]>): Generator<typeof PAUSE, VpkEntry[]> {
    const key = JSON.stringify(inputs);
    const hit = shared.get(name);
    if (hit && hit.key === key) return hit.entries;
    const entries = yield* make();
    shared.set(name, { key, entries });
    return entries;
  }

  // the item builder's enabled picks, for which arcana bases they put on (src/arcana-bases.ts): not
  // a plain one of a hero with a persona on, which the build leaves out (src/item-builder-personas.ts)
  const picks = () => {
    const on = library.list().filter((r) => r.enabled !== false && isItemPick(r));
    const personas = personasOn(on);
    return on.filter((r) => !leftOut(r, personas)).map((r) => ({ itemId: String(r.itemId), style: styleOf(itemBuilder.effectKey(r.effectId)) }));
  };

  /**
   * Enabled mods' lifted item blocks + the free cosmetics the user picked, a step for each pick
   * that had to be built anew. A cosmetic pick is a library record like any other (categoryId
   * 'cosmetic', slot + itemId of its own), so toggling, deleting and sharing it in a preset all go
   * through the normal machinery. `beneath`: the arcana bases' files, which every pick's own win
   * over (schema.deploy).
   */
  function* buildSteps(vanillaText: string, game: string): Generator<BuildYield, { list: schema.SchemaPatch[]; beneath: VpkEntry[]; filesShared: FilesShared }> {
    if (builtFrom !== vanillaText || builtGame !== game) { built.clear(); shared.clear(); builtFrom = vanillaText; builtGame = game; }
    const used = new Set<string>();
    // what the picks are built from, made a pause at a time before the first pick needs it: the
    // table's list of items (300 ms), the game's index (270 ms) and the arcana bases (a read of up
    // to 20 MB each), which held the window for most of a second after every start (issue #286)
    yield* listItemsSteps(vanillaText);
    // Terrorblade's in the arcana window's colour while its record is on (src/arcana-base-color.ts)
    const ready = colored(bases ? yield* basesHereSteps(picks(), bases, log) : [], windowColor(library.list()));
    const out: schema.SchemaPatch[] = [];
    const sounds: SoundSwap[] = [];
    const voices: VoiceCue[] = [];
    const portraits: PortraitSwap[] = [];
    const sprites: SpriteSwap[] = [];
    // what the personas asked of the shared files, which the picks' pak leaves out with them
    const fromPersona = new Set<object>();
    // a persona whose base is here is on without the table too: the base is its body, and its own items go as files
    const worn = (rec: BuildRecord) => !rec.persona || ready.some((r) => r.base.persona && `item:${r.base.hero}:` === String(rec.slot).slice(0, r.base.hero.length + 6));
    const gems = new Map<string, Set<string>>();
    // a copy: a build in the background goes on while the user changes the library; with each
    // persona's own items in, and what cannot be worn with it out (src/item-builder-personas.ts)
    const { records: all, left } = personaRecords(library.list().filter((r) => r.enabled !== false), vanillaText);
    // the ability effects slots' picks first: the build keeps the first file of a path and the first
    // sound swap, and in the game the slot's effects win over those of the item worn
    const records = [...all.filter((r) => fxSlotOf(r.slot)), ...all.filter((r) => !fxSlotOf(r.slot))];
    for (const { rec, why } of left) log(`schema: ${rec.name} left out of the build: ${why}`);
    const models = new Map<BuildRecord, PickModels>();
    for (const rec of records) {
      const m = isItemPick(rec) && !fxSlotOf(rec.slot) ? pickModels(vanillaText, String(rec.itemId), rec.effectId) : null;
      if (m) models.set(rec, m);
    }
    const refits = refitsOf(models);
    const pak = path.join(game, 'dota', 'pak01_dir.vpk');
    // a persona's body compiled bigger than Valve's makes its items as big (src/model-scale.ts)
    const on = personasOn(records);
    const index = on.size && fs.existsSync(pak) ? yield* sharedVpkIndexSteps(pak) : null;
    const scales = index ? personaScales(on, ready, (p) => index.read(p)) : new Map<string, number>();
    const scaleOf = (r: BuildRecord) => personaScaleOf(r, scales);
    const total = records.filter((r) => isItemPick(r) && !built.has(pickKey(r, ready, refits.get(r), scaleOf(r)))).length;
    if (total && fs.existsSync(pak)) yield* sharedVpkIndexSteps(pak);
    let done = 0;
    const fxPatches = new Set<schema.SchemaPatch>();
    const owned: { patch: schema.SchemaPatch; own: string | null }[] = [];
    for (const rec of records) {
      if (rec.categoryId === 'cosmetic') {
        const fresh = isItemPick(rec) && !built.has(pickKey(rec, ready, refits.get(rec), scaleOf(rec)));
        try {
          if (isItemPick(rec)) {
            const key = pickKey(rec, ready, refits.get(rec), scaleOf(rec));
            const pick = builtPick(vanillaText, game, key, rec, ownBase(rec, ready), refits.get(rec), scaleOf(rec));
            used.add(key);
            const assets = rec.persona && !isSelectorSlot(rec.slot)
              ? personaAssets(rec, pick.assets, ready) : withoutBaseFiles(String(rec.itemId), pick.assets, ready);
            const patch = { id: pick.id, block: pick.block, assets, source: rec.name, own: pick.own, added: pick.added, unplaced: pick.unplaced, item: worn(rec) };
            out.push(patch);
            if (fxSlotOf(rec.slot)) fxPatches.add(patch);
            owned.push({ patch, own: pick.own });
            sounds.push(...pick.sounds);
            voices.push(...pick.voices);
            portraits.push(...pick.portraits);
            sprites.push(...pick.sprites);
            if (!worn(rec)) for (const swap of [...pick.sounds, ...pick.voices, ...pick.portraits, ...pick.sprites]) fromPersona.add(swap);
            if (pick.kinetic?.length) for (const hero of pick.heroes ?? []) { const on = gems.get(hero) ?? new Set<string>(); gems.set(hero, on); for (const m of pick.kinetic) on.add(m); }
          } else {
            const patch = lookPatch(vanillaText, game, rec, log);
            if (patch) out.push(patch);
          }
        } catch (err) {
          // A donor Valve removed drops out of the build, and so does a pick the builder refuses.
          // Said in the log, because the window cannot tell: it showed "installed" either way.
          log(`schema: ${rec.name} left out of the build: ${(err as Error)?.message || err}`);
        }
        if (fresh) yield { done: ++done, total };
        continue;
      }
      if (!Array.isArray(rec.schema)) continue;
      for (const d of rec.schema) out.push({ id: d.id, block: d.block, source: rec.name });
    }
    ownModelsWin(owned);
    // every hero's picks in one ability effects slot dress the one stock item all heroes wear there
    const list = mergeFxPatches(out, (p) => fxPatches.has(p));
    // Two picks rewrite the same soundevents file, portrait settings and sprite sheet, and the build
    // keeps the first file of a path it is given: so every pick's go into one copy of each, ahead
    // of all other files. On an item pick where there is one: without the table a persona's files stay
    // out (src/item-files.ts), and every hero's minimap icon and sounds went with it
    const first = list.find((p) => p.assets && p.item) ?? list.find((p) => p.assets);
    const made = first ? yield* sharedFiles('', sounds, voices, portraits, sprites) : [];
    if (first) first.assets = [...made, ...first.assets!];
    // the picks' pak, without the table, carries no persona: its minimap icon, portrait and lines
    // would have gone on the plain hero (Invoker's minimap icon was the Acolyte's)
    const mine = <T extends object>(swaps: T[]) => swaps.filter((x) => !fromPersona.has(x));
    const filesShared: FilesShared = { paths: made.map((e) => entryPath(e).toLowerCase()),
      entries: fromPersona.size ? yield* sharedFiles('-items', mine(sounds), mine(voices), mine(portraits), mine(sprites)) : made };
    for (const key of built.keys()) if (!used.has(key)) built.delete(key); // a pick taken off lets its files go
    let moves: VpkEntry[] = [];
    try {
      // eslint-disable-next-line require-yield
      moves = yield* sharedEntries('kinetic', [...gems].map(([hero, on]) => [hero, [...on].sort()]), function* () { return kineticEntries(game, gems); });
    } catch (err) {
      log(`schema: the kinetic gems' animations left out of the build: ${(err as Error)?.message || err}`);
    }
    return { list, beneath: [...ready.flatMap((r) => r.entries), ...moves], filesShared };
  }

  /** The soundevents, portrait settings and sprite sheet every pick rewrites, as one copy of each. */
  function* sharedFiles(tag: string, sounds: SoundSwap[], voices: VoiceCue[], portraits: PortraitSwap[], sprites: SpriteSwap[]): Generator<typeof PAUSE, VpkEntry[]> {
    const out: VpkEntry[] = [];
    try {
      // eslint-disable-next-line require-yield
      out.push(...yield* sharedEntries(`portraits${tag}`, [portraits, sprites], function* () { return portraitEntries(builtGame!, portraits, sprites); }));
    } catch (err) {
      log(`schema: the heroes' portraits left out of the build: ${(err as Error)?.message || err}`);
    }
    try {
      // the soundevents are 946 files to read and parse, 300 ms whatever the picks
      out.push(...yield* sharedEntries(`sounds${tag}`, [sounds, voices], () => soundEntriesSteps(builtGame!, sounds, voices)));
    } catch (err) {
      log(`schema: the items' sounds left out of the build: ${(err as Error)?.message || err}`);
    }
    return out;
  }

  return {
    buildSteps,
    picks,
    /** Everything kept, let go: the game was patched, and a pick's files, sounds and portraits can change with its block the same. */
    forget() { built.clear(); shared.clear(); },
  };
}

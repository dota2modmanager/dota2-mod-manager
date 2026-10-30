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
import { isSelectorSlot, leftOut, personaAssets, personaRecords, personasOn, type BuildRecord } from './item-builder-personas.ts';
import { createColoredBases, windowColor } from './arcana-base-color.ts';
import { lookPatch } from './courier-models.ts';
import type { BaseStore } from './arcana-base-store.ts';
import { sharedVpkIndex, sharedVpkIndexSteps, type VpkEntry } from './vpk.ts';
import { PAUSE } from './steps.ts';
import type { LibRecord } from './types.ts';
import type { Library } from './library.ts';

/** A pick of the item builder as built: its block, and the game's files under the plain paths. */
type ItemPick = { id: string; block: string; own: string | null; assets: VpkEntry[] } & ItemAssets;

/** How far a build is: the picks built anew so far out of those it has to, or the stage of the write. */
export type BuildStep = { done: number; total: number } | { stage: 'merged' | 'checked' | 'packed' };
export { buildBar } from './build-bar.ts';

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
  const pickKey = (rec: BuildRecord, ready: ReadyBase[], refit?: string) => {
    const own = ownBase(rec, ready);
    return `${rec.itemId}|${itemBuilder.effectKey(rec.effectId)}${own ? `|${own.base.id}:${baseSignature(own)}` : ''}${rec.persona ? `@${rec.persona.target}` : ''}${refit ? `~${refit}` : ''}`;
  };
  function builtPick(vanillaText: string, game: string, key: string, rec: BuildRecord, own: ReadyBase | undefined, refit: string | undefined): ItemPick {
    let pick = built.get(key);
    if (!pick) {
      // a summon's plain model, from the game's unit scripts: read only for an item that swaps one
      const summon: itemBuilder.SummonModels = (...args) => summonModels(sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk')))(...args);
      const made = itemBuilder.itemEffectPatch(vanillaText, String(rec.itemId), rec.effectId, rec.persona?.target, summon, refit);
      pick = { ...made, assets: itemBuilder.gameAssetEntries(game, made.assetCopies, own && ((p) => own.paths.has(p))) };
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
  function* buildSteps(vanillaText: string, game: string): Generator<BuildYield, { list: schema.SchemaPatch[]; beneath: VpkEntry[] }> {
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
    // a copy: a build in the background goes on while the user changes the library; with each
    // persona's own items in, and what cannot be worn with it out (src/item-builder-personas.ts)
    const { records, left } = personaRecords(library.list().filter((r) => r.enabled !== false), vanillaText);
    for (const { rec, why } of left) log(`schema: ${rec.name} left out of the build: ${why}`);
    const models = new Map<BuildRecord, PickModels>();
    for (const rec of records) {
      const m = isItemPick(rec) ? pickModels(vanillaText, String(rec.itemId), rec.effectId) : null;
      if (m) models.set(rec, m);
    }
    const refits = refitsOf(models);
    const total = records.filter((r) => isItemPick(r) && !built.has(pickKey(r, ready, refits.get(r)))).length;
    const pak = path.join(game, 'dota', 'pak01_dir.vpk');
    if (total && fs.existsSync(pak)) yield* sharedVpkIndexSteps(pak);
    let done = 0;
    const owned: { patch: schema.SchemaPatch; own: string | null }[] = [];
    for (const rec of records) {
      if (rec.categoryId === 'cosmetic') {
        const fresh = isItemPick(rec) && !built.has(pickKey(rec, ready, refits.get(rec)));
        try {
          if (isItemPick(rec)) {
            const key = pickKey(rec, ready, refits.get(rec));
            const pick = builtPick(vanillaText, game, key, rec, ownBase(rec, ready), refits.get(rec));
            used.add(key);
            const assets = rec.persona && !isSelectorSlot(rec.slot)
              ? personaAssets(rec, pick.assets, ready) : withoutBaseFiles(String(rec.itemId), pick.assets, ready);
            const patch = { id: pick.id, block: pick.block, assets, source: rec.name };
            out.push(patch);
            owned.push({ patch, own: pick.own });
            sounds.push(...pick.sounds);
            voices.push(...pick.voices);
            portraits.push(...pick.portraits);
            sprites.push(...pick.sprites);
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
    // Two picks rewrite the same soundevents file, portrait settings and sprite sheet, and the build
    // keeps the first file of a path it is given: so every pick's go into one copy of each, ahead
    // of all other files.
    const first = out.find((p) => p.assets);
    if (first) {
      try {
        // eslint-disable-next-line require-yield
        const made = yield* sharedEntries('portraits', [portraits, sprites], function* () { return portraitEntries(game, portraits, sprites); });
        first.assets = [...made, ...first.assets!];
      } catch (err) {
        log(`schema: the heroes' portraits left out of the build: ${(err as Error)?.message || err}`);
      }
      try {
        // the soundevents are 946 files to read and parse, 300 ms whatever the picks
        const made = yield* sharedEntries('sounds', [sounds, voices], () => soundEntriesSteps(game, sounds, voices));
        first.assets = [...made, ...first.assets!];
      } catch (err) {
        log(`schema: the items' sounds left out of the build: ${(err as Error)?.message || err}`);
      }
    }
    for (const key of built.keys()) if (!used.has(key)) built.delete(key); // a pick taken off lets its files go
    return { list: out, beneath: ready.flatMap((r) => r.entries) };
  }

  return {
    buildSteps,
    picks,
    /** Everything kept, let go: the game was patched, and a pick's files, sounds and portraits can change with its block the same. */
    forget() { built.clear(); shared.clear(); },
  };
}

/**
 * Builds in the background, one at a time and in order. A build asked for while one runs stops
 * that one before it writes anything, since its list of picks is out of date already, and builds
 * once more from what the library holds then; everybody waiting gets the result of the build that
 * wrote. A build run in place in between (heal, the patch switch) does the same, through `ran`.
 * @param steps    a build of the table, a step at a time
 * @param onBuild  each step of a build in the background, and null when it ends
 */
export function createBackgroundBuilds(steps: () => Generator<BuildYield, Refreshed, boolean | undefined>, onBuild: (step: BuildStep | null) => void) {
  let generation = 0;
  let chain: Promise<void> = Promise.resolve();
  const waiting: { gen: number; resolve: (r: Refreshed) => void }[] = [];
  function settle(gen: number, result: Refreshed) {
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (waiting[i].gen > gen) continue;
      waiting[i].resolve(result);
      waiting.splice(i, 1);
    }
  }
  return {
    /** A build that ran in place, all at once: its result answers everybody waiting on an older one. */
    ran(result: Refreshed): Refreshed {
      settle(++generation, result);
      return result;
    },

    /** A build in the background: answers once the table is written, by this build or a newer one. */
    inBackground(): Promise<Refreshed> {
      const gen = ++generation;
      const answer = new Promise<Refreshed>((resolve) => waiting.push({ gen, resolve }));
      chain = chain.then(async () => {
        if (gen !== generation) return; // a newer request is behind this one
        const run = steps();
        let wrote: boolean | undefined;
        try {
          for (;;) {
            const r = run.next(wrote);
            wrote = undefined;
            if (r.done) { settle(gen, r.value); return; }
            const step = r.value;
            if (step !== PAUSE && 'write' in step) {
              // the pak written without holding the thread; one that fails is tried again in
              // place by deploySteps, whose error is then the build's
              try { await fs.promises.writeFile(step.write, step.data); wrote = true; } catch { wrote = false; }
            } else {
              if (step !== PAUSE) onBuild(step);
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
            if (gen !== generation) { run.return({ ok: true, superseded: true }); return; }
          }
        } catch (err) {
          settle(gen, { ok: false, error: String((err as Error)?.message || err) });
        } finally {
          onBuild(null);
        }
      });
      return answer;
    },

    /** Whether a build is running or asked for and has not answered: quitting waits (src/quit-after-build.ts). */
    busy: () => waiting.length > 0,

    /** Resolves once no build is running or asked for: the Play button waits on it. */
    async settled(): Promise<void> {
      for (let last = null as Promise<void> | null; last !== chain;) {
        last = chain;
        await last;
      }
    },
  };
}

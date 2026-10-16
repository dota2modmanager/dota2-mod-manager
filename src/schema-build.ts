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
import * as schema from './schema.ts';
import * as itemBuilder from './item-builder.ts';
import { soundEntries, type SoundSwap, type VoiceCue } from './item-sounds.ts';
import { portraitEntries } from './item-portraits.ts';
import type { ItemAssets, PortraitSwap, SpriteSwap } from './item-builder-assets.ts';
import { styleOf } from './item-builder-styles.ts';
import { basesHere, withoutBaseFiles } from './arcana-bases.ts';
import type { BaseStore } from './arcana-base-store.ts';
import type { VpkEntry } from './vpk.ts';
import type { LibRecord } from './types.ts';
import type { Library } from './library.ts';

/** A pick of the item builder as built: its block, and the game's files under the plain paths. */
type ItemPick = { id: string; block: string; assets: VpkEntry[] } & ItemAssets;

/** How far a build is: the picks built anew so far out of those it has to, or the stage of the write. */
export type BuildStep = { done: number; total: number } | { stage: 'merged' | 'checked' | 'packed' };

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

/** A generator run to its end at once: the steps of a build, for a caller that does not wait between them. */
export function drain<R>(steps: Generator<unknown, R>): R {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * The bar at the bottom of the window for a build in the background: shown once the build has run
 * for `after` ms, so a pick that takes a fifth of a second does not flash it, and counted in the
 * picks built anew. A build with none to build, the merge and the write alone, shows nothing.
 */
export function buildBar(send: (evt: { type: 'count'; label: string; done: number; total: number } | { type: 'done' }) => void,
  label: () => string, after = 400, now = () => Date.now()): (step: BuildStep | null) => void {
  let started: number | null = null;
  let shown = false;
  let picks = { done: 0, total: 0 };
  return (step) => {
    if (!step) {
      if (shown) send({ type: 'done' });
      started = null;
      shown = false;
      picks = { done: 0, total: 0 };
      return;
    }
    started ??= now();
    // the stages of the write come after every pick: the count stays full while they run
    picks = 'total' in step ? step : { done: picks.total, total: picks.total };
    if (!picks.total || (!shown && now() - started < after)) return;
    shown = true;
    send({ type: 'count', label: label(), ...picks });
  };
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
  const pickKey = (rec: LibRecord) => `${rec.itemId}|${itemBuilder.effectKey(rec.effectId)}`;
  function builtPick(vanillaText: string, game: string, key: string, rec: LibRecord): ItemPick {
    let pick = built.get(key);
    if (!pick) {
      const made = itemBuilder.itemEffectPatch(vanillaText, String(rec.itemId), rec.effectId);
      pick = { ...made, assets: itemBuilder.gameAssetEntries(game, made.assetCopies) };
      built.set(key, pick);
    }
    return pick;
  }
  function sharedEntries(name: string, inputs: unknown, make: () => VpkEntry[]): VpkEntry[] {
    const key = JSON.stringify(inputs);
    const hit = shared.get(name);
    if (hit && hit.key === key) return hit.entries;
    const entries = make();
    shared.set(name, { key, entries });
    return entries;
  }

  // the item builder's enabled picks, for which arcana bases they put on (src/arcana-bases.ts)
  const picks = () => library.list().filter((r) => r.enabled !== false && isItemPick(r))
    .map((r) => ({ itemId: String(r.itemId), style: styleOf(itemBuilder.effectKey(r.effectId)) }));
  const readyBases = () => (bases ? basesHere(picks(), bases, log) : []);

  /**
   * Enabled mods' lifted item blocks + the free cosmetics the user picked, a step for each pick
   * that had to be built anew. A cosmetic pick is a library record like any other (categoryId
   * 'cosmetic', slot + itemId of its own), so toggling, deleting and sharing it in a preset all go
   * through the normal machinery. `beneath`: the arcana bases' files, which every pick's own win
   * over (schema.deploy).
   */
  function* buildSteps(vanillaText: string, game: string): Generator<BuildStep, { list: schema.SchemaPatch[]; beneath: VpkEntry[] }> {
    if (builtFrom !== vanillaText || builtGame !== game) { built.clear(); shared.clear(); builtFrom = vanillaText; builtGame = game; }
    const used = new Set<string>();
    const ready = readyBases();
    const out: schema.SchemaPatch[] = [];
    const sounds: SoundSwap[] = [];
    const voices: VoiceCue[] = [];
    const portraits: PortraitSwap[] = [];
    const sprites: SpriteSwap[] = [];
    // a copy: a build in the background goes on while the user changes the library
    const records = library.list().filter((r) => r.enabled !== false);
    const total = records.filter((r) => isItemPick(r) && !built.has(pickKey(r))).length;
    let done = 0;
    for (const rec of records) {
      if (rec.categoryId === 'cosmetic') {
        const fresh = isItemPick(rec) && !built.has(pickKey(rec));
        try {
          if (isItemPick(rec)) {
            const key = pickKey(rec);
            const pick = builtPick(vanillaText, game, key, rec);
            used.add(key);
            const assets = withoutBaseFiles(String(rec.itemId), pick.assets, ready);
            out.push({ id: pick.id, block: pick.block, assets, source: rec.name });
            sounds.push(...pick.sounds);
            voices.push(...pick.voices);
            portraits.push(...pick.portraits);
            sprites.push(...pick.sprites);
          } else {
            const target = schema.baseItemFor(vanillaText, rec.slot);
            if (target) out.push({ id: target.id, block: schema.baseItemPatch(vanillaText, target.id, String(rec.itemId)), source: rec.name });
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
    // Two picks rewrite the same soundevents file, portrait settings and sprite sheet, and the build
    // keeps the first file of a path it is given: so every pick's go into one copy of each, ahead
    // of all other files.
    const first = out.find((p) => p.assets);
    if (first) {
      try {
        first.assets = [...sharedEntries('portraits', [portraits, sprites], () => portraitEntries(game, portraits, sprites)), ...first.assets!];
      } catch (err) {
        log(`schema: the heroes' portraits left out of the build: ${(err as Error)?.message || err}`);
      }
      try {
        // the soundevents are 946 files to read and parse, 300 ms whatever the picks
        first.assets = [...sharedEntries('sounds', [sounds, voices], () => soundEntries(game, sounds, voices)), ...first.assets!];
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
export function createBackgroundBuilds(steps: () => Generator<BuildStep, Refreshed>, onBuild: (step: BuildStep | null) => void) {
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
        try {
          for (;;) {
            const r = run.next();
            if (r.done) { settle(gen, r.value); return; }
            onBuild(r.value);
            await new Promise<void>((resolve) => setImmediate(resolve));
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

    /** Resolves once no build is running or asked for: the Play button waits on it. */
    async settled(): Promise<void> {
      for (let last = null as Promise<void> | null; last !== chain;) {
        last = chain;
        await last;
      }
    },
  };
}

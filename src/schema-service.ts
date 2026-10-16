// Orchestration around the item schema: what goes into it, when it is rebuilt, and how a
// game update is repaired. Kept out of src/main.ts so the whole flow can be exercised without
// starting Electron.
//
// The rules it enforces:
//   - the schema is ALWAYS rebuilt from the installed game's own items_game.txt, so it can
//     never be the stale copy a mod happened to ship;
//   - a mod's changes live in the library record (record.schema), never in its VPK;
//   - nothing is written to the game unless the user turned the patch on.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as patcher from './patcher.ts';
import * as schema from './schema.ts';
import { createHarvest, type SchemaInstaller } from './schema-harvest.ts';
import { createCosmetics } from './schema-cosmetics.ts';
import { createBackgroundBuilds, createTableBuild, drain, type BuildStep, type Refreshed } from './schema-build.ts';
import { chooseBases } from './arcana-bases.ts';
import type { BaseStore } from './arcana-base-store.ts';
import type { Settings } from './settings.ts';
import type { Library } from './library.ts';

export type { SchemaInstaller } from './schema-harvest.ts';
export type { CosmeticSlot } from './schema-cosmetics.ts';
export { buildBar, type BuildStep, type Refreshed } from './schema-build.ts';

let builderCode: string | null | undefined;
/**
 * The app's own code, as a fingerprint of src/: a build the item builder made is only as right as the
 * code that made it. A fix to how a pick is built never reached the picks already built, which kept
 * the old files until each was taken off and picked again. Read once per run (~150 small files,
 * inside app.asar when packaged); null where it cannot be read, which rebuilds nothing.
 */
export function builderStamp(dir = import.meta.dirname): string | null {
  if (builderCode !== undefined && dir === import.meta.dirname) return builderCode;
  let out: string | null = null;
  try {
    const hash = crypto.createHash('sha1');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts')).sort()) hash.update(f).update(fs.readFileSync(path.join(dir, f)));
    out = hash.digest('hex').slice(0, 12);
  } catch { /* not readable: the game's stamp alone decides */ }
  if (dir === import.meta.dirname) builderCode = out;
  return out;
}

/** The patch and the built table as Settings shows them; the patcher's own state is merged in. */
export interface SchemaState extends Partial<patcher.PatchState> {
  enabled: boolean; folder: string | null; patched: boolean; signed: boolean; foreign: string | null;
  deployed: boolean; stale: boolean; mods: number; cosmeticsPicked: number;
  conflicts: { id: string; name: string; mods: string[] }[];
  error?: string;
}

/**
 * @param {object} deps
 * @param {import('./settings').Settings} deps.settings
 * @param {import('./library').Library} deps.library
 * @param {import('./installer').Installer} deps.installer
 * @param {string} deps.userDataDir
 * @param {(msg: string) => void} [deps.log]  the app's diagnostics log
 * @param deps.bases  the arcana bases kept on disk (src/arcana-base-store.ts); none: the game's files
 * @param deps.onBuild how far a build in the background is (refreshInBackground), null when it ended
 */
/** The item table and the search-path patch, kept in step with the library and the installed game. */
export function createSchemaService({ settings, library, installer, userDataDir, log = () => {}, bases, onBuild = () => {} }: {
  settings: Pick<Settings, 'get' | 'set'>; library: Library; installer: SchemaInstaller; userDataDir: string; log?: (msg: string) => void;
  bases?: Pick<BaseStore, 'entries' | 'want'>;
  onBuild?: (step: BuildStep | null) => void;
}) {
  const backupDir = path.join(userDataDir, 'backups', 'patch');
  const gamePath = () => settings.get('dotaGamePath');
  // what the deployed table was built from: the game's item table, and the code that built it
  const stampOf = (table: string | null) => (table ? [table, builderStamp()].filter(Boolean).join('|') : null);
  // every pick built once, and the patches of everything else (src/schema-build.ts)
  const table = createTableBuild({ library, bases, log });

  // The game's table is 50 MB and walking its 25k items costs ~300 ms, while the picker
  // asks about a dozen slots in a row. Hold on to the text until the game itself changes:
  // the stamp is a stat() of the paks, so noticing an update stays cheap.
  let cache: { stamp: string | null; base: schema.GameSchema | null } = { stamp: null, base: null };
  /** The game's own table, read once per build of the game. */
  function vanillaBase(): schema.GameSchema {
    const game = gamePath() as string;
    let stamp: string | null = null;
    try { stamp = schema.gameSchemaStamp(game); } catch { /* fall through to a fresh read */ }
    if (stamp && cache.stamp === stamp && cache.base) return cache.base;
    const base = schema.readGameSchema(game);
    cache = { stamp, base };
    table.forget();
    return base;
  }
  const vanilla = () => vanillaBase().text;

  // the patches a build would merge, all at once
  const patches = (vanillaText: string, game: string) => drain(table.buildSteps(vanillaText, game)).list;

  // builds in the background (refreshInBackground), and the Play button waiting on them (settled)
  const builds = createBackgroundBuilds(() => refreshSteps(), onBuild);

  // Rebuild and write the schema pak, or remove it when nothing needs one.
  function refresh() {
    return builds.ran(drain(refreshSteps()));
  }

  /** refresh, a step at a time: each pick built anew, then the merge, the check and the pak. */
  function* refreshSteps(): Generator<BuildStep, Refreshed> {
    const game = gamePath();
    if (!game) return { ok: false, reason: 'no-game-path' };
    try {
      const drop = () => {
        schema.undeploy({ gamePath: game, folder: patcher.FOLDER });
        settings.set('schemaStamp', null);
        return { ok: true, deployed: false, patches: 0 };
      };
      if (!settings.get('schemaPatch')) return drop();
      // through the cache, not around it: this runs on every mod removed, enabled or
      // switched off, and re-extracting 50 MB from the game's pak each time was the wait
      const base = vanillaBase();
      const { list, beneath } = yield* table.buildSteps(base.text, game);
      if (!list.length) return drop();
      const steps = schema.deploySteps({ gamePath: game, folder: patcher.FOLDER, patches: list, base, beneath });
      let res: schema.Deployed;
      for (;;) {
        const r = steps.next();
        if (r.done) { res = r.value; break; }
        yield { stage: r.value };
      }
      settings.set('schemaStamp', stampOf(res.stamp));
      return { ok: true, deployed: true, patches: res.applied.length, missing: res.missing, conflicts: res.conflicts, bytes: res.bytes };
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message || err) };
    }
  }

  /** The table built without holding up the app: what the window asks for when the user picks,
   *  switches or takes off an item, and what a downloaded arcana base asks for. */
  const refreshInBackground = () => builds.inBackground();
  const settled = () => builds.settled();

  // A Dota update overwrites the patched gameinfo and moves the item table underneath our
  // build. Runs on startup and before launching the game.
  function heal() {
    const game = gamePath();
    if (!game) return { ok: true, healed: [] };
    // Safe mode still needs a look: if the game's own file is not what Valve signed, the
    // client refuses the install and nothing in the app is on to explain it. Putting the
    // verified original back is the whole repair (see patcher.restoreBranch).
    if (!settings.get('schemaPatch')) {
      try {
        if (patcher.state(game, patcher.FOLDER).vanillaOk) return { ok: true, healed: [] };
        patcher.revert({ gamePath: game, folder: patcher.FOLDER, backupDir });
        return { ok: true, healed: patcher.state(game, patcher.FOLDER).vanillaOk ? ['vanilla'] : [] };
      } catch (err) {
        return { ok: false, error: String((err as Error)?.message || err), healed: [] };
      }
    }
    const healed: string[] = [];
    try {
      const st = patcher.state(game, patcher.FOLDER);
      // an install with no signature list has nothing to sign the patch into, so an unsigned
      // patch there is finished rather than half-done (Linux; see patcher.state). A patch built
      // from an older gameinfo.gi is rebuilt even when signed: Steam leaves the branch file alone
      // when a build does not change it, and the stale copy can unmount the language folder.
      if (!st.patched || st.outdated || (st.signable && !st.signed)) {
        patcher.apply({ gamePath: game, folder: patcher.FOLDER, backupDir });
        healed.push('patch');
      }
      // a new build of the game or of the app: either can change what a pick builds into
      const stamp = stampOf(schema.readGameSchema(game).stamp);
      if (stamp !== settings.get('schemaStamp') || !schema.isDeployed(game, patcher.FOLDER)) {
        refresh();
        healed.push('schema');
      }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message || err), healed };
    }
    return { ok: true, healed };
  }

  // Turn the patch on or off. This is the only place that edits files of the game install
  // itself, and it is reached only from an explicit user action.
  function setEnabled(on: boolean) {
    const game = gamePath();
    if (!game) return { error: 'no-game-path' };
    if (on) {
      patcher.apply({ gamePath: game, folder: patcher.FOLDER, backupDir });
      settings.set('schemaPatch', true);
      // refresh answers with its own ok, which is the one that counts
      return refresh();
    }
    settings.set('schemaPatch', false);
    schema.undeploy({ gamePath: game, folder: patcher.FOLDER });
    patcher.revert({ gamePath: game, folder: patcher.FOLDER, backupDir });
    settings.set('schemaStamp', null);
    return { ok: true, deployed: false };
  }

  // Two mods changing the same item block DIFFERENTLY: only one of them can be in the built
  // table (the one installed later), so the library has to say so instead of quietly
  // dropping the other. Identical blocks are not a conflict at all - Skinchanger bundles
  // the whole cart into every export, so two of its packs routinely carry the same block.
  function conflicts(): SchemaState['conflicts'] {
    const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
    const byId = new Map<string, { id: string; name: string; mods: string[]; texts: Set<string> }>();
    for (const rec of library.list()) {
      if (rec.enabled === false || !Array.isArray(rec.schema)) continue;
      for (const d of rec.schema) {
        let entry = byId.get(d.id);
        if (!entry) { entry = { id: d.id, name: d.name, mods: [], texts: new Set() }; byId.set(d.id, entry); }
        entry.mods.push(rec.name);
        entry.texts.add(flat(d.block));
      }
    }
    return [...byId.values()]
      .filter((c) => c.texts.size > 1)
      .map(({ id, name, mods }) => ({ id, name, mods }));
  }

  function state(): SchemaState {
    const game = gamePath();
    const out: SchemaState = {
      enabled: !!settings.get('schemaPatch'),
      folder: patcher.FOLDER,
      patched: false,
      signed: false,
      foreign: null,
      deployed: false,
      stale: false,
      mods: library.list().filter((r) => r.enabled !== false && Array.isArray(r.schema) && r.schema.length).length,
      cosmeticsPicked: library.list().filter((r) => r.categoryId === 'cosmetic' && r.enabled !== false).length,
      conflicts: conflicts(),
    };
    if (!game) return out;
    try {
      Object.assign(out, patcher.state(game, patcher.FOLDER));
      out.deployed = schema.isDeployed(game, patcher.FOLDER);
      if (out.deployed) out.stale = stampOf(schema.readGameSchema(game).stamp) !== settings.get('schemaStamp');
    } catch (err) {
      out.error = String((err as Error)?.message || err);
    }
    return out;
  }

  const { harvest, split, migrate } = createHarvest({ library, installer, gamePath, vanilla });
  const { cosmeticSlots, pickCosmetic, pickSet, migrateCosmeticSettings } = createCosmetics({
    library, settings, gamePath, vanilla, refresh,
  });

  // At start: the bases the picks need, in case the last run closed before one came or a newer one
  // was published. Whatever comes builds again (src/services.ts).
  const askForBases = () => { if (bases && settings.get('schemaPatch')) for (const b of chooseBases(table.picks())) void bases.want(b.id); };

  return {
    backupDir, patches, refresh, refreshInBackground, settled, heal, setEnabled, harvest, split, migrate, state,
    cosmeticSlots, pickCosmetic, pickSet, migrateCosmeticSettings, askForBases,
  };
}

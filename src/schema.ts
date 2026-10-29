// Item-schema engine: the game's own scripts/items/items_game.txt is the only place
// where a mod can attach new particles to a hero, redirect a stock effect, or turn a
// free "base item" (default weather / terrain / HUD...) into a paid one.
//
// Two rules shape everything here:
//   1. Only one items_game.txt may be live, so mods never ship theirs — we lift the
//      changed item blocks out of them and splice those into the game's CURRENT file.
//   2. The result is rebuilt from the installed game every time, so it can never go
//      stale the way a schema shipped inside a mod does.
//
// The file is ~50 MB of KeyValues with a few non-UTF8 bytes in it, so everything here
// works on latin1 strings: byte-exact in and out, no re-encoding surprises.
//
// The code is kept readable as four files: src/schema-kv.ts walks the KeyValues text,
// src/schema-items.ts reads items out of it, src/schema-merge.ts lifts a mod's deltas and merges
// them, and this file builds the result and writes it into the game. Callers import from here.
import fs from 'node:fs';
import path from 'node:path';
import { buildVpk, entryAt, type VpkEntry } from './vpk.ts';
import { readGameSchema, type GameSchema } from './schema-items.ts';
import { mergeSchema, validateSchemaSteps, type MergeResult, type SchemaPatch } from './schema-merge.ts';
import { drain, PAUSE } from './steps.ts';

export { blockBounds, eachChild } from './schema-kv.ts';
export type { Bounds, KvChild } from './schema-kv.ts';
export {
  SCHEMA_REL, findItem, itemFields, listItems, listItemsSteps, toUtf8, itemSearchText, inferredItemSlot, baseItemFor,
  cosmeticOptions, readGameSchema, gameSchemaStamp,
} from './schema-items.ts';
export type { SchemaItem, GameSchema } from './schema-items.ts';
export {
  reindent, ownedAssetNeedles, blockUsesAssets, deltaTable, extractDeltas, stripKeyBlocks, baseItemPatch,
  mergeSchema, validateSchema,
} from './schema-merge.ts';
export type { SchemaDelta, SchemaPatch, MergeResult } from './schema-merge.ts';

/** Our folder is registered ahead of "dota", so the first pak in it wins the MOD path. */
export const SCHEMA_VPK = 'pak01_dir.vpk';

/** Pack the merged schema as a one-file VPK holding items_game.txt and the files its patches bring. */
export function buildSchemaVpk(text: string, extraEntries: VpkEntry[] = []): Buffer {
  const data = Buffer.from(text, 'latin1');
  return buildVpk([entryAt('scripts/items/items_game.txt', data), ...extraEntries]);
}

/**
 * Build the schema and put it in the mod folder. Always rebuilt from the installed
 * game, so a Dota update is repaired by calling this again - never by shipping a copy.
 *
 * `base` is the game's own table, which the caller has usually just read: it is 50 MB out of
 * a VPK and reading it twice for one deploy was most of what removing a mod cost. Left out,
 * it is read here as before.
 * @param opts.folder  the mod folder the schema VPK is written into
 * @param opts.base    the game's own table, if already read
 * @param opts.beneath files every patch's own win over where both have a path: an arcana base
 *   (src/arcana-bases.ts), which another item picked for one of its slots replaces there
 */
export function deploy(opts: DeployOptions): Deployed {
  return drain(deploySteps(opts));
}

/** What deploy is given. */
export interface DeployOptions { gamePath: string; folder: string; patches: SchemaPatch[]; base?: GameSchema; beneath?: VpkEntry[] }
/** What deploy wrote. */
export type Deployed = MergeResult & { stamp: string; bytes: number; items: number };
/** A stage of deploySteps; `write` asks the caller to write the pak where it can wait for the disk. */
export type DeployStep = { stage: 'merged' | 'checked' | 'packed' } | { write: string; data: Buffer } | typeof PAUSE;
/** temporary files of the pak, one name each: a write in the background and one in place can overlap */
let writes = 0;

/**
 * deploy, a stage at a time: the merge, the check, the pak, the write, each a yield apart, so a
 * caller that builds in the background (src/schema-build.ts) lets the rest of the app run between
 * them, and can stop before the write when a newer build has taken over. The write is handed to
 * that caller to do without holding the thread (a pak with arcana bases in it is 200 MB), and
 * done here when the caller does not take it (next(true) says it did). Nothing is written to the
 * game before the last stage.
 */
export function* deploySteps({ gamePath, folder, patches, base = readGameSchema(gamePath), beneath = [] }: DeployOptions): Generator<DeployStep, Deployed, boolean | undefined> {
  const merged = mergeSchema(base.text, patches);
  yield { stage: 'merged' };
  const checked = yield* validateSchemaSteps(merged.text, base.text);
  yield { stage: 'checked' };
  const extras: VpkEntry[] = [];
  const seen = new Set<string>();
  for (const assets of [...(patches || []).map((p) => p.assets || []), beneath]) {
    for (const en of assets) {
      const key = `${en.folder}/${en.name}.${en.ext}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push(en);
    }
  }
  const buf = buildSchemaVpk(merged.text, extras);
  yield { stage: 'packed' };
  const dir = path.join(gamePath, folder);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, SCHEMA_VPK);
  const tmp = `${dest}.${process.pid}-${++writes}.mmtmp`;
  try {
    if (!(yield { write: tmp, data: buf })) fs.writeFileSync(tmp, buf);
    fs.rmSync(dest, { force: true });
    fs.renameSync(tmp, dest);
  } finally {
    // gone after the rename; left by a failed write, or a build stopped for a newer one
    fs.rmSync(tmp, { force: true });
  }
  return { ...merged, stamp: base.stamp, bytes: checked.bytes, items: checked.items };
}

// Any real file left in a directory tree (the engine drops empty rpt/ and save/ folders
// into every mounted content path, and those must not keep the folder alive).
function hasFiles(dir: string): boolean {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (hasFiles(path.join(dir, e.name))) return true; }
    else return true;
  }
  return false;
}

/** Drop the built schema, and the folder with it once nothing of ours is left there. */
export function undeploy({ gamePath, folder }: { gamePath: string; folder: string }): void {
  const dir = path.join(gamePath, folder);
  const dest = path.join(dir, SCHEMA_VPK);
  if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  if (fs.existsSync(dir) && !hasFiles(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Take away the writes of the pak another run left half done: an app closed while a build wrote
 * left 190 MB beside the pak, and nothing ever took it away. This run's own are its builds' to
 * finish, so only another process's go. Answers how many went.
 */
export function sweepUnfinished(gamePath: string, folder: string, pid = process.pid): number {
  const dir = path.join(gamePath, folder);
  if (!fs.existsSync(dir)) return 0;
  const left = fs.readdirSync(dir).filter((f) => f.startsWith(`${SCHEMA_VPK}.`) && f.endsWith('.mmtmp') && !f.startsWith(`${SCHEMA_VPK}.${pid}-`));
  for (const f of left) fs.rmSync(path.join(dir, f), { force: true });
  return left.length;
}

/** Whether a built schema is in the mod folder. */
export function isDeployed(gamePath: string, folder: string): boolean {
  return fs.existsSync(path.join(gamePath, folder, SCHEMA_VPK));
}

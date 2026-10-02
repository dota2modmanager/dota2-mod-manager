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
import { mergeSchema, validateSchema, type MergeResult, type SchemaPatch } from './schema-merge.ts';

export { blockBounds, eachChild } from './schema-kv.ts';
export type { Bounds, KvChild } from './schema-kv.ts';
export {
  SCHEMA_REL, findItem, itemFields, listItems, toUtf8, itemSearchText, inferredItemSlot, baseItemFor,
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
 */
export function deploy({ gamePath, folder, patches, base = readGameSchema(gamePath) }: {
  gamePath: string; folder: string; patches: SchemaPatch[]; base?: GameSchema;
}): MergeResult & { stamp: string; bytes: number; items: number } {
  const merged = mergeSchema(base.text, patches);
  const checked = validateSchema(merged.text, base.text);
  const extras: VpkEntry[] = [];
  const seen = new Set<string>();
  for (const p of patches || []) {
    for (const en of p.assets || []) {
      const key = `${en.folder}/${en.name}.${en.ext}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push(en);
    }
  }
  const buf = buildSchemaVpk(merged.text, extras);
  const dir = path.join(gamePath, folder);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, SCHEMA_VPK);
  const tmp = dest + '.mmtmp';
  fs.writeFileSync(tmp, buf);
  try {
    fs.rmSync(dest, { force: true });
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
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

/** Whether a built schema is in the mod folder. */
export function isDeployed(gamePath: string, folder: string): boolean {
  return fs.existsSync(path.join(gamePath, folder, SCHEMA_VPK));
}

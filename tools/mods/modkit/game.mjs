/**
 * The game for modkit: its folder (`--game`, else the app's settings, else where Steam put it),
 * its pak01 read through the app's own VPK reader, and the app's KV3 reader and writer, all
 * through mm-cli (tools/dev/mm-cli.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { appGamePath } from './lib.mjs';

export const { mm, call, jsonFile, binFile, tmpDir } = createRequire(import.meta.url)('../../dev/mm-cli.js');

/** "<...>/dota 2 beta/game", or an error that says what to pass. */
export async function gameFolder(opts) {
  const game = typeof opts.game === 'string' ? opts.game : appGamePath() || mm('find-dota');
  if (!game || !fs.existsSync(path.join(game, 'dota', 'pak01_dir.vpk'))) {
    throw new Error('Dota 2 not found: pass --game "<...>/steamapps/common/dota 2 beta/game"');
  }
  return game;
}

/**
 * A VPK as an index: paths(), has(path), crc(path), read(path) and prefetch(paths), which reads
 * many in one go. Each file is read once.
 */
export function vpkIndex(vpk) {
  const crcs = new Map(mm('vpk-entries', vpk));
  const got = new Map();
  const prefetch = (list) => {
    const want = [...new Set(list)].filter((p) => crcs.has(p) && !got.has(p));
    if (!want.length) return;
    const dir = fs.mkdtempSync(path.join(tmpDir(), 'pak-'));
    for (const p of mm('vpk-extract', vpk, dir, jsonFile(want))) got.set(p, fs.readFileSync(path.join(dir, ...p.split('/'))));
    fs.rmSync(dir, { recursive: true, force: true });
    for (const p of want) if (!got.has(p)) got.set(p, null);
  };
  return {
    file: vpk,
    paths: () => crcs.keys(),
    has: (p) => crcs.has(p),
    crc: (p) => crcs.get(p),
    prefetch,
    read(p) {
      if (!crcs.has(p)) return null;
      prefetch([p]);
      return got.get(p);
    },
  };
}

/** The game's pak01 as an index (vpkIndex). */
export async function pak01(opts) {
  const game = await gameFolder(opts);
  return { game, index: vpkIndex(path.join(game, 'dota', 'pak01_dir.vpk')) };
}

/** A file's crc32, as the VPK's directory keeps it. */
export const crc32 = (data) => zlib.crc32(data);

// KV3 through mm-cli: a block is { root }, a node { kind, ... } with objects' members in a Map,
// arrays' items in a list and each number's own bytes in `raw` (a Buffer), so a node copied out
// of one block can go into another as it is.

const SIGNED = new Set([3, 5, 11, 19, 20, 22]);
const FLOAT = new Set([5, 19]);

function fromTree(n) {
  if (n.kind === 'object') return { ...n, members: new Map(n.members.map(([k, v]) => [k, fromTree(v)])) };
  if (n.kind === 'array') return { ...n, items: n.items.map(fromTree) };
  if (n.kind === 'number') return { ...n, raw: n.raw == null ? null : Buffer.from(n.raw, 'hex') };
  return n;
}

function toTree(n) {
  if (n.kind === 'object') return { ...n, members: [...n.members].map(([k, v]) => [k, toTree(v)]) };
  if (n.kind === 'array') return { ...n, items: n.items.map(toTree) };
  if (n.kind === 'number') return { kind: 'number', type: n.type, ...(n.raw ? { raw: n.raw.toString('hex') } : {}), ...(n.flag ? { flag: n.flag } : {}) };
  return n;
}

/** The named blocks of a compiled file (a Buffer) as trees: { DATA: { root }, ... }. */
export function readBlocks(file, names) {
  const f = path.join(tmpDir(), `kv-${process.hrtime.bigint()}.bin`);
  fs.writeFileSync(f, file);
  const trees = mm('kv3-tree', f, jsonFile(names));
  fs.rmSync(f, { force: true });
  return Object.fromEntries(Object.entries(trees).map(([k, t]) => [k, { root: fromTree(t) }]));
}

/** The file with each block written anew from its tree, and `references` added to its list. */
export function writeBlocks(file, blocks, references = []) {
  const f = path.join(tmpDir(), `kv-${process.hrtime.bigint()}.bin`);
  const out = `${f}.out`;
  fs.writeFileSync(f, file);
  mm('kv3-put', f, jsonFile({ blocks: Object.entries(blocks).map(([k, kv]) => [k, toTree(kv.root)]), references }), out);
  const bytes = fs.readFileSync(out);
  fs.rmSync(f, { force: true });
  fs.rmSync(out, { force: true });
  return bytes;
}

/** A number node's value: from its bytes, or from its type for a 0 or 1 stored as a type alone. */
export function numberOf(_kv, n) {
  if (!n || n.kind !== 'number') return null;
  const r = n.raw;
  if (!r) return [16, 18, 27].includes(n.type) ? 1 : 0;
  if (FLOAT.has(n.type)) return r.length === 4 ? r.readFloatLE(0) : r.readDoubleLE(0);
  if (r.length === 8) return Number(SIGNED.has(n.type) ? r.readBigInt64LE(0) : r.readBigUInt64LE(0));
  return SIGNED.has(n.type) ? r.readIntLE(0, r.length) : r.readUIntLE(0, r.length);
}

/** Set a number node in its own bytes; one stored as a type alone turns only into the other of 0 and 1. */
export function setNumber(_kv, n, v) {
  const r = n.raw;
  if (!r) {
    if (v !== 0 && v !== 1) return false;
    n.type = n.type >= 26 ? 26 + v : n.type <= 16 ? 15 + v : 17 + v;
    return true;
  }
  if (FLOAT.has(n.type)) { if (r.length === 4) r.writeFloatLE(v, 0); else r.writeDoubleLE(v, 0); return true; }
  if (r.length === 8) { if (SIGNED.has(n.type)) r.writeBigInt64LE(BigInt(Math.trunc(v)), 0); else r.writeBigUInt64LE(BigInt(Math.trunc(v)), 0); return true; }
  if (SIGNED.has(n.type)) r.writeIntLE(Math.trunc(v), 0, r.length); else r.writeUIntLE(Math.trunc(v), 0, r.length);
  return true;
}

/** A deep copy of a node, its numbers' bytes included. */
export function detached(_kv, n) {
  if (n.kind === 'object') return { ...n, members: new Map([...n.members].map(([k, c]) => [k, detached(_kv, c)])) };
  if (n.kind === 'array') return { ...n, items: n.items.map((c) => detached(_kv, c)) };
  if (n.kind === 'number') return { ...n, raw: n.raw ? Buffer.from(n.raw) : null };
  return { ...n };
}

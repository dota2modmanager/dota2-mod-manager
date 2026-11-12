#!/usr/bin/env node
/**
 * The same steps timed in TypeScript and in Rust (crates/mm-core through mm-cli), on one game:
 * the sandbox by default, or the real one with --game (read only: nothing here writes).
 * Best of N runs each. docs/rust-migration.md keeps the last numbers.
 *
 *   cargo build --release -p mm-cli && node tools/rust-bench.mjs [--game "<...>\dota 2 beta\game"] [--runs 5]
 */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openVpkIndex, readVpkIndexFile, fingerprintVpk } from '../src/vpk.ts';
import { readVpkEntryFile } from '../src/vpk-read.ts';
import { listItems, countItems } from '../src/schema-items.ts';

const root = path.resolve(import.meta.dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const game = path.resolve(arg('game', path.join(root, 'sandbox', 'steamapps', 'common', 'dota 2 beta', 'game')));
const runs = Number(arg('runs', '5'));
const exe = (p) => path.join(root, 'target', p, process.platform === 'win32' ? 'mm-cli.exe' : 'mm-cli');
const cli = fs.existsSync(exe('release')) ? exe('release') : exe('debug');
const pak = path.join(game, 'dota', 'pak01_dir.vpk');

const best = (f) => {
  let b = Infinity;
  for (let i = 0; i < runs; i++) { const t = performance.now(); f(i); b = Math.min(b, performance.now() - t); }
  return b;
};
const ts = {
  openPak01Index: best(() => openVpkIndex(pak)),
  readItemsGame: best(() => readVpkEntryFile(pak, 'scripts/items/items_game.txt')),
};
const text = readVpkEntryFile(pak, 'scripts/items/items_game.txt').data.toString('latin1');
// listItems keeps its last answers by the string's value: a table that differs by trailing spaces
// is a miss every run, and the walk is the same
const fresh = Array.from({ length: runs * 2 }, (_, i) => text + ' '.repeat(i + 1));
ts.listItems = best((i) => listItems(fresh[i]));
ts.countItems = best((i) => countItems(fresh[runs + i]));
const idx = readVpkIndexFile(pak);
ts.fingerprintPak01 = best(() => fingerprintVpk(idx));

const rust = JSON.parse(execFileSync(cli, ['bench', game, String(runs)], { encoding: 'utf8' }));
console.log(`game: ${game}\nmm-cli: ${path.relative(root, cli)}\n`);
console.log('step'.padEnd(20), 'TypeScript'.padStart(12), 'Rust'.padStart(10), 'faster'.padStart(8));
for (const k of Object.keys(ts)) {
  console.log(k.padEnd(20), `${ts[k].toFixed(1)} ms`.padStart(12), `${rust[k].toFixed(1)} ms`.padStart(10), `${(ts[k] / rust[k]).toFixed(1)}x`.padStart(8));
}

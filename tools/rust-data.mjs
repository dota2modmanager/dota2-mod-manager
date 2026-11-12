#!/usr/bin/env node
// The tables the Rust rewrite reads (crates/mm-core/data/*.json), written from the TypeScript
// modules that hold them today, so the two cannot drift: test/rust-data.test.ts fails when a table
// here is not what its module exports. A map is a list of [key, value] pairs in the order the
// module lists them (some lookups keep the first of two keys), a list is the list. When the
// TypeScript goes, the JSON becomes the source. docs/rust-migration.md.
//
//   node tools/rust-data.mjs           write every table
//   node tools/rust-data.mjs --check   say which tables are out of date, exit 1 if any
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'crates', 'mm-core', 'data');

/** [file, module, export ('default' for the default one)] */
export const TABLES = [
  ['i18n-en.json', 'src/i18n-en.ts', 'default'],
  ['i18n-zh-CN.json', 'src/i18n-zh-CN.ts', 'default'],
  ['hero-display.json', 'src/hero-names.ts', 'HERO_DISPLAY'],
  ['hero-alias.json', 'src/hero-names.ts', 'HERO_ALIAS'],
  ['item-effects.json', 'src/item-builder-effects.ts', 'ITEM_EFFECTS'],
  ['recolor-sets.json', 'src/recolor-sets.ts', 'RECOLOR_SETS'],
  ['arcana-bases.json', 'src/arcana-bases.ts', 'ARCANA_BASES'],
  ['arcana-notes.json', 'src/arcana-notes.ts', 'ARCANA_NOTES'],
  ['arcanas-that-work.json', 'src/arcana-notes.ts', 'ARCANAS_THAT_WORK'],
  ['heroes-not-checked.json', 'src/arcana-notes.ts', 'HEROES_NOT_CHECKED'],
];

/** Every table as the text its file should hold. */
export async function tables() {
  const res = {};
  for (const [file, mod, name] of TABLES) {
    const m = await import(pathToFileURL(path.join(root, mod)).href);
    const value = m[name];
    if (!value || typeof value !== 'object') throw new Error(`${mod} has no table ${name}`);
    // a list or a set is written as it is, one element a line; a map or an object as its pairs
    const rows = Array.isArray(value) || value instanceof Set ? [...value] : value instanceof Map ? [...value] : Object.entries(value);
    res[file] = `[\n${rows.map((p) => JSON.stringify(p)).join(',\n')}\n]\n`;
  }
  return res;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check');
  const want = await tables();
  const stale = [];
  fs.mkdirSync(out, { recursive: true });
  for (const [file, text] of Object.entries(want)) {
    const at = path.join(out, file);
    let has = null;
    try { has = fs.readFileSync(at, 'utf8'); } catch { /* not written yet */ }
    if (has === text) continue;
    stale.push(file);
    if (!check) fs.writeFileSync(at, text);
  }
  if (check && stale.length) {
    console.error(`out of date: ${stale.join(', ')} (node tools/rust-data.mjs)`);
    process.exit(1);
  }
  console.log(stale.length ? `${check ? 'stale' : 'wrote'}: ${stale.join(', ')}` : 'every table is current');
}

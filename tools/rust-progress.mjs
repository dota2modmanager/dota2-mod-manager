#!/usr/bin/env node
/**
 * How far the move to Rust has got: every IPC channel the window can call (src/channel-args.ts),
 * and which of them Rust answers itself (a `"channel" =>` arm in src-tauri/src/*.rs). The rest
 * are still answered by the TypeScript main process running behind the Tauri shell.
 *
 *   node tools/rust-progress.mjs          summary and the channels left, grouped by prefix
 *   node tools/rust-progress.mjs --json   the same as data
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { CHANNEL_ARGS } = await import(pathToFileURL(path.join(root, 'src', 'channel-args.ts')).href);
const all = Object.keys(CHANNEL_ARGS).sort();

const rustDir = path.join(root, 'src-tauri', 'src');
const rust = new Set();
for (const f of fs.readdirSync(rustDir, { recursive: true })) {
  if (!String(f).endsWith('.rs')) continue;
  const text = fs.readFileSync(path.join(rustDir, String(f)), 'utf8');
  for (const m of text.matchAll(/"([a-zA-Z0-9]+:[a-zA-Z0-9:_-]+)"\s*(?:\|[^=]*)?=>/g)) rust.add(m[1]);
  for (const m of text.matchAll(/\|\s*"([a-zA-Z0-9]+:[a-zA-Z0-9:_-]+)"/g)) rust.add(m[1]);
}
const done = all.filter((c) => rust.has(c));
const left = all.filter((c) => !rust.has(c));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: all.length, rust: done, host: left }, null, 2));
} else {
  console.log(`channels in Rust: ${done.length} of ${all.length} (${Math.round((100 * done.length) / all.length)}%)`);
  const groups = new Map();
  for (const c of left) {
    const g = c.split(':')[0];
    groups.set(g, [...(groups.get(g) || []), c]);
  }
  for (const [g, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${g} (${list.length}): ${list.map((c) => c.slice(g.length + 1)).join(' ')}`);
  }
}

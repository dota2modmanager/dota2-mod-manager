#!/usr/bin/env node
/**
 * How far the move to Rust has got: every IPC channel the window can call (the argument table in
 * crates/mm-core/src/owner/channel_args.rs, which refuses any channel it does not list),
 * and which of them Rust answers: the title bar's buttons in the shell (a `"channel" =>` arm in
 * src-tauri/src/*.rs) and every channel the state's owner lists (`CHANNELS` in
 * crates/mm-core/src/owner_*.rs). Anything left would reach no one under Tauri.
 *
 *   node tools/dev/rust-progress.mjs          summary and the channels left, grouped by prefix
 *   node tools/dev/rust-progress.mjs --json   the same as data
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const table = fs.readFileSync(path.join(root, 'crates', 'mm-core', 'src', 'owner', 'channel_args.rs'), 'utf8');
// a channel opens a row of the table, `("mods:update", vec![...])`, or stands in the list of those with none
const all = [...new Set([...table.matchAll(/(?:^\s*|\(\s*)"([a-zA-Z0-9]+:[a-zA-Z0-9:_-]+)",/gm)].map((m) => m[1]))].sort();

const CHANNEL = /"([a-zA-Z0-9]+:[a-zA-Z0-9:_-]+)"/g;
const rust = new Set();
const shellDir = path.join(root, 'src-tauri', 'src');
for (const f of fs.readdirSync(shellDir, { recursive: true })) {
  if (!String(f).endsWith('.rs')) continue;
  const text = fs.readFileSync(path.join(shellDir, String(f)), 'utf8');
  for (const m of text.matchAll(/"([a-zA-Z0-9]+:[a-zA-Z0-9:_-]+)"\s*(?:\|[^=]*)?=>/g)) rust.add(m[1]);
  for (const m of text.matchAll(/\|\s*"([a-zA-Z0-9]+:[a-zA-Z0-9:_-]+)"/g)) rust.add(m[1]);
}
const coreDir = path.join(root, 'crates', 'mm-core', 'src', 'owner');
for (const f of fs.readdirSync(coreDir)) {
  if (!/^(mod|owner(_\w+)?)\.rs$/.test(f)) continue;
  const text = fs.readFileSync(path.join(coreDir, f), 'utf8');
  const list = text.match(/pub const CHANNELS: &\[&str\] =\s*&\[([\s\S]*?)\];/);
  if (list) for (const m of list[1].matchAll(CHANNEL)) rust.add(m[1]);
}
const done = all.filter((c) => rust.has(c));
const left = all.filter((c) => !rust.has(c));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: all.length, rust: done, left }, null, 2));
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

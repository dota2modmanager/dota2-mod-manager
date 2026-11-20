// A channel the window calls has to pass two places in Rust: the argument table in
// crates/mm-core/src/owner/channel_args.rs, which refuses any channel it does not list, and a
// handler, either the shell's (a `"channel" =>` arm in src-tauri/src/*.rs, the title bar's
// buttons) or the owner's (`CHANNELS` in crates/mm-core/src/owner/). Missing from either, the
// button calling it does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const NAME = '([a-zA-Z0-9]+:[a-zA-Z0-9:_-]+)';

// a channel opens a row of the table, `("mods:update", vec![...])`, or stands in the list of those with none
const table = new Set([...read('crates', 'mm-core', 'src', 'owner', 'channel_args.rs').matchAll(new RegExp(`(?:^\\s*|\\(\\s*)"${NAME}",`, 'gm'))].map((m) => m[1]));

const answered = new Set<string>();
const shell = path.join(ROOT, 'src-tauri', 'src');
for (const f of fs.readdirSync(shell, { recursive: true }).map(String).filter((f) => f.endsWith('.rs'))) {
  const text = fs.readFileSync(path.join(shell, f), 'utf8');
  for (const m of text.matchAll(new RegExp(`"${NAME}"\\s*(?:\\|[^=]*)?=>`, 'g'))) answered.add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\|\\s*"${NAME}"`, 'g'))) answered.add(m[1]);
}
const owner = path.join(ROOT, 'crates', 'mm-core', 'src', 'owner');
for (const f of fs.readdirSync(owner).filter((f) => /^(mod|owner(_\w+)?)\.rs$/.test(f))) {
  const list = fs.readFileSync(path.join(owner, f), 'utf8').match(/pub const CHANNELS: &\[&str\] =\s*&\[([\s\S]*?)\];/);
  if (list) for (const m of list[1].matchAll(new RegExp(`"${NAME}"`, 'g'))) answered.add(m[1]);
}

const called = (file: string) =>
  new Set([...read('src-tauri', 'src', 'page', file).matchAll(new RegExp(`mm\\.(?:invoke|send)\\('${NAME}'`, 'g'))].map((m) => m[1]));

test('the channel lists were read', () => {
  assert.ok(table.size > 100, `the argument table (${table.size})`);
  assert.ok(answered.size > 100, `the handlers (${answered.size})`);
});

test('every channel in the argument table is answered in Rust', () => {
  assert.deepEqual([...table].filter((c) => !answered.has(c)).sort(), []);
});

for (const file of ['api.js', 'uninstall-api.js']) {
  test(`every channel ${file} calls is in the argument table`, () => {
    const calls = called(file);
    assert.ok(calls.size > 0, `${file}'s calls were read`);
    assert.deepEqual([...calls].filter((c) => !table.has(c)).sort(), []);
  });
}

// Since the Node host left the Tauri shell, a channel the window can call that no Rust code
// answers is a button that does nothing under Tauri. tools/rust-progress.mjs counts them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

test('every channel the window can call is answered in Rust', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'rust-progress.mjs'), '--json'], { encoding: 'utf8' });
  const { total, left } = JSON.parse(out) as { total: number; left: string[] };
  assert.ok(total > 100, `the channel list was read (${total})`);
  assert.deepEqual(left, []);
});

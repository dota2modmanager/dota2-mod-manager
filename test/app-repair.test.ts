// Settings' "Repair the app" (src/app-repair.ts, issue #431): a line per step, from a broken state.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { missingMods, repairApp } from '../src/app-repair.ts';
import type { PatchRepair } from '../src/game-repair.ts';

function folder(t: { after: (fn: () => void) => void }, files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-431-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
  return dir;
}

const mod = (name: string, rel: string, enabled = true) => ({ name, enabled, files: [{ root: 'lang', relPath: rel }] });

test('a switched-on mod whose pak is gone is named; a switched-off copy and a cursor are not', (t) => {
  const dir = folder(t, ['pak30_dir.vpk', 'pak32_dir.vpk.off']);
  const onDisk = (rel: string) => ['', '.off'].map((s) => path.join(dir, rel + s)).find((p) => fs.existsSync(p)) || path.join(dir, rel);
  const names = missingMods([
    mod('Here', 'pak30_dir.vpk'),
    mod('Gone', 'pak31_dir.vpk'),
    mod('Off on disk', 'pak32_dir.vpk'),
    mod('Off and gone', 'pak33_dir.vpk', false),
    { name: 'Cursor', enabled: true, files: [{ root: 'cursor', relPath: 'cursor.vtex_c' }] },
  ], onDisk);
  assert.deepEqual(names, ['Gone']);
});

function run(state: PatchRepair, { missing = false, throwsCaches = false } = {}) {
  const calls: string[] = [];
  return repairApp({
    repairAfterPatch: async (reason) => { calls.push(`patch:${reason}`); },
    patchRepair: () => state,
    records: () => (missing ? [mod('Lost mod', 'nowhere/pak99_dir.vpk')] : []),
    onDisk: (rel) => path.join(os.tmpdir(), 'repair-431-none', rel),
    clearCaches: () => { if (throwsCaches) throw new Error('locked'); calls.push('caches'); },
  }).then((steps) => ({ steps, calls }));
}

test('a healthy app answers three green lines and still clears the pictures', async () => {
  const { steps, calls } = await run({ state: 'done', healed: [] });
  assert.deepEqual(steps.map((s) => [s.id, s.ok]), [['game', true], ['files', true], ['caches', true]]);
  assert.deepEqual(calls, ['patch:manual', 'caches']);
});

test('a patch that failed, a lost file and a cache that will not clear are three red lines, in order', async () => {
  const { steps } = await run({ state: 'failed', error: 'gameinfo is read-only' }, { missing: true, throwsCaches: true });
  assert.deepEqual(steps.map((s) => [s.id, s.ok]), [['game', false], ['files', false], ['caches', false]]);
  assert.equal(steps[0].text, 'gameinfo is read-only');
  assert.deepEqual(steps[1].mods, ['Lost mod']);
  assert.match(steps[2].text, /locked/);
});

test('Dota running is a red line that says to close it, and the rest still runs', async () => {
  const { steps, calls } = await run({ state: 'waiting' });
  assert.equal(steps[0].ok, false);
  assert.match(steps[0].text, /Dota 2/);
  assert.ok(calls.includes('caches'));
});

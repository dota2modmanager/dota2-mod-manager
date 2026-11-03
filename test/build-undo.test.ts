/* Cancel on the item table's bar (src/build-undo.ts, issue #425): the build stops, and the library
 * goes back to the table the game has, so the two agree. A pick made since goes, a mod switched
 * since is switched back with its files, a look taken off comes back, and a mod whose files went
 * is named as the one that could not. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Library } from '../src/library.ts';
import { createBuildUndo } from '../src/build-undo.ts';
import { createBackgroundBuilds } from '../src/schema-build.ts';
import { PAUSE } from '../src/steps.ts';
import type { LibRecord } from '../src/types.ts';

function world(t: TestContext, { building = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-build-undo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  const renamed: [string, boolean][] = [];
  let off = false;
  const installer = {
    setEnabled: (files: { relPath: string }[], on: boolean) => { for (const f of files) renamed.push([f.relPath, on]); },
    masterIsOff: () => off,
    setMasterEnabled: (on: boolean) => { off = !on; return {}; },
  };
  const values: Record<string, unknown> = { everyoneWearsMine: false, schemaPending: false };
  const settings = { get: (k: string) => values[k], set: (k: string, v: unknown) => { values[k] = v; } };
  const undo = createBuildUndo({ library, installer: installer as never, settings: settings as never, schema: { cancel: () => building } });
  const pick = (name: string, itemId: number) => library.update(library.add({ name, categoryId: 'cosmetic', files: [] }).id, { slot: 'items', itemId: String(itemId) })!;
  const mod = (name: string) => library.update(library.add({ name, categoryId: 'hero-items', files: [{ relPath: `pak${name}_dir.vpk` }] as never }).id,
    { schema: [{ id: '1', block: '' }] } as Partial<LibRecord>)!;
  return { library, undo, renamed, values, pick, mod, master: () => off, setOff: (v: boolean) => { off = v; } };
}

test('Cancel takes off a pick made since the table, and puts back one changed or taken off', (t) => {
  const w = world(t);
  const kept = w.pick('Kept', 1);
  const gone = w.pick('Gone', 2);
  w.undo.mark();
  w.library.update(kept.id, { effectId: 'golden' } as Partial<LibRecord>);
  w.library.removeRecord(gone.id);
  w.pick('New', 3);
  w.values.schemaPending = true;

  const r = w.undo.cancel();
  assert.deepEqual(r, { ok: true, undone: 3, left: [] });
  assert.deepEqual(w.library.list().map((x) => x.name).sort(), ['Gone', 'Kept']);
  assert.equal((w.library.find(kept.id) as LibRecord & { effectId?: string }).effectId, undefined, 'the effect picked since is gone');
  assert.equal(w.values.schemaPending, false, 'the game and the library agree again');
});

test('a mod switched since is switched back with its files; one installed since is kept, off', (t) => {
  const w = world(t);
  const on = w.mod('10');
  w.undo.mark();
  w.library.setEnabled(on.id, false);
  const added = w.mod('11');
  w.undo.cancel();
  assert.equal(w.library.find(on.id)!.enabled, true);
  assert.equal(w.library.find(added.id)!.enabled, false);
  assert.deepEqual(w.renamed, [['pak10_dir.vpk', true], ['pak11_dir.vpk', false]]);
});

test('a mod removed since cannot come back: it is named, and the table stays due', (t) => {
  const w = world(t);
  const m = w.mod('12');
  w.undo.mark();
  w.library.removeRecord(m.id);
  w.values.schemaPending = true;
  assert.deepEqual(w.undo.cancel(), { ok: true, undone: 1, left: [m.name] });
  assert.equal(w.values.schemaPending, true);
});

test('the master switch and "everyone wears mine" go back with the rest', (t) => {
  const w = world(t);
  w.undo.mark();
  w.setOff(true);
  w.values.everyoneWearsMine = true;
  w.undo.cancel();
  assert.equal(w.master(), false);
  assert.equal(w.values.everyoneWearsMine, false);
});

test('nothing is touched when no build runs, or when the app does not know what the game has', (t) => {
  const idle = world(t, { building: false });
  idle.undo.mark();
  idle.pick('New', 1);
  assert.deepEqual(idle.undo.cancel(), { ok: false, reason: 'nothing' });
  assert.equal(idle.library.list().length, 1);
  const blind = world(t);
  assert.deepEqual(blind.undo.cancel(), { ok: false, reason: 'unknown' });
});

test('a cancelled build stops before it writes, and everybody waiting hears so', async () => {
  let wrote = false;
  const builds = createBackgroundBuilds(function* () {
    for (let i = 0; i < 50; i++) yield PAUSE;
    wrote = true;
    return { ok: true, deployed: true };
  }, () => {});
  const answer = builds.inBackground();
  await new Promise((r) => setImmediate(r));
  assert.equal(builds.cancel(), true);
  assert.deepEqual(await answer, { ok: true, cancelled: true });
  await builds.settled();
  assert.equal(wrote, false, 'the pak was never written');
  assert.equal(builds.busy(), false);
  assert.equal(builds.cancel(), false, 'nothing left to cancel');
});

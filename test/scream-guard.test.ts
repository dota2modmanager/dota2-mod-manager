/* The pumpkin's mod on an install that did not open the pumpkin (src/scream-guard.ts): found by
 * what is inside it whatever it is called, switched off and marked; left alone where a key was
 * spent; and looked into once per mod.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScreamGuard, isScream, screamGuardFor } from '../src/scream-guard.ts';
import { buildVpk, entryAt } from '../src/vpk-write.ts';
import type { LibRecord } from '../src/types.ts';

const SCREAM = ['particles/units/heroes/hero_necrolyte/x.vpcf_c', 'materials/scream_fx/necro_ti9_immortal_ghost/a.vtex_c'];
const OTHER = ['particles/units/heroes/hero_necrolyte/x.vpcf_c', 'materials/models/heroes/necrolyte/necrolyte_color.vtex_c'];

function world(key: string | null) {
  const recs: LibRecord[] = [
    { id: 'a', name: 'cool necro skin', categoryId: 'imported', enabled: true, files: [{ root: 'lang', relPath: 'pak31_dir.vpk' }] },
    { id: 'b', name: 'Necrophos Base', categoryId: 'heroes', enabled: true, files: [{ root: 'lang', relPath: 'pak32_dir.vpk' }] },
  ] as LibRecord[];
  const paks: Record<string, string[]> = { a: SCREAM, b: OTHER };
  const reads: string[] = [];
  const off: string[] = [];
  const guard = createScreamGuard({
    library: { list: () => recs, update: (id, f) => Object.assign(recs.find((r) => r.id === id)!, f) },
    settings: { get: (k) => (k === 'bloodKey' ? key : undefined) },
    pathsOf: (rec) => { reads.push(rec.id); return paks[rec.id]; },
    switchOff: (rec) => { off.push(rec.id); rec.enabled = false; },
  });
  return { recs, reads, off, guard };
}

test('the mod is known by its own folders, not by its name', () => {
  assert.equal(isScream(SCREAM), true);
  assert.equal(isScream(['MATERIALS\\Models\\Heroes\\Necrolyte\\Scream\\mask_color.vtex_c']), true);
  assert.equal(isScream(OTHER), false);
});

test('a copy on an install that spent no key is switched off and marked', () => {
  const w = world(null);
  assert.deepEqual(w.guard(), ['cool necro skin']);
  assert.deepEqual(w.off, ['a']);
  assert.equal(w.recs[0].cheat, true);
  assert.equal(w.recs[1].cheat, undefined);
  assert.equal(w.recs[1].enabled, true);
  // already off: nothing to do the second time, and nothing read again
  assert.deepEqual(w.guard(), []);
  assert.deepEqual(w.reads, ['a', 'b']);
});

test('where the key was spent the mod is left alone, and an old mark comes off', () => {
  const w = world('ABCDEFGHJKMNPQRS');
  w.recs[0].cheat = true;
  assert.deepEqual(w.guard(), []);
  assert.deepEqual(w.off, []);
  assert.equal(w.recs[0].cheat, false);
  assert.equal(w.recs[0].enabled, true);
});

test('over the game folder: the pak is read from disk and the copy goes off with its record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-scream-'));
  try {
    fs.writeFileSync(path.join(dir, 'pak40_dir.vpk'), buildVpk(SCREAM.map((p) => entryAt(p, Buffer.from('x')))));
    const recs = [
      { id: 'a', name: 'renamed', categoryId: 'imported', enabled: true, files: [{ root: 'lang', relPath: 'pak40_dir.vpk' }] },
      { id: 'b', name: 'a cursor', categoryId: 'cursors', enabled: true, files: [{ root: 'cursor', relPath: 'arrow.cur' }] },
      { id: 'c', name: 'gone', categoryId: 'imported', enabled: true, files: [{ root: 'lang', relPath: 'pak41_dir.vpk' }] },
    ] as LibRecord[];
    const switched: string[] = [];
    const guard = screamGuardFor({
      installer: { langFileOnDisk: (rel) => path.join(dir, rel), setEnabled: (files, on, id) => { switched.push(`${id}:${on}`); } },
      library: {
        list: () => recs,
        update: (id, f) => Object.assign(recs.find((r) => r.id === id)!, f),
        setEnabled: (id, on) => { recs.find((r) => r.id === id)!.enabled = on; },
      },
      settings: { get: () => undefined },
    });
    assert.deepEqual(guard(), ['renamed']);
    assert.deepEqual(switched, ['a:false']);
    assert.equal(recs[0].enabled, false);
    // a mod with no pak is looked at once and is not it; an unreadable pak is asked again later
    assert.equal(recs[1].scream, false);
    assert.equal(recs[2].scream, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

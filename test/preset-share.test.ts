// A .d2mm arrives from a stranger over Discord, so reading one is the app's most exposed
// path after downloading a mod. These pin the round trip and the two ways a hostile file
// can misbehave: a manifest that is not what it claims, and an archive turned down by the
// size checks — whose reason has to survive rather than become "cannot be opened".
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Thrown } from './helpers/thrown.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import * as share from '../src/preset-share.ts';

function tempFile(t: TestContext, name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-preset-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, name);
}

test('a preset written by the app reads back with its mods intact', (t) => {
  const out = tempFile(t, 'set.d2mm');
  share.writePresetFile(out, { name: 'Мой сет', author: { name: 'Misha' } }, [
    { kind: 'catalog', categoryId: 'heroes', name: 'Alien Nyx Assassin', styleLabel: null, fp: 'abc' },
    { kind: 'embedded', name: 'My own mod', categoryId: 'imported', data: Buffer.from('vpk bytes here') },
    { kind: 'cosmetic', name: 'Golden Full-Bore Bonanza', slot: 'items', itemId: '9455', effectId: 'frostbloom' },
  ]);

  const { manifest, readMod } = share.readPresetFile(out);
  assert.equal(manifest.name, 'Мой сет');
  assert.equal(manifest.author, 'Misha');
  assert.deepEqual(manifest.mods.map((m) => m.kind), ['catalog', 'embedded', 'cosmetic']);
  assert.deepEqual(manifest.mods[2], {
    kind: 'cosmetic', name: 'Golden Full-Bore Bonanza', slot: 'items', itemId: '9455', effectId: 'frostbloom',
  });
  const embedded = manifest.mods[1];
  assert.equal(embedded.kind, 'embedded');
  assert.equal(embedded.kind === 'embedded' && readMod(embedded.file).toString(), 'vpk bytes here');
});

test('a zip that is not a preset is refused before anything is read out of it', (t) => {
  const out = tempFile(t, 'random.d2mm');
  const zip = new AdmZip();
  zip.addFile('holiday.jpg', Buffer.from('not a preset'));
  zip.writeZip(out);
  assert.throws(() => share.readPresetFile(out), /preset|Пресет/i);
});

test('a bomb dressed as a preset is turned down with the reason it was turned down for', (t) => {
  const out = tempFile(t, 'bomb.d2mm');
  const zip = new AdmZip();
  zip.addFile('preset.json', Buffer.from(JSON.stringify({ format: share.FORMAT, version: 1, mods: [] })));
  zip.addFile('mods/000.vpk', Buffer.alloc(8 * 1024 * 1024));
  zip.writeZip(out);
  assert.throws(() => share.readPresetFile(out), (err: Thrown) => err.safeZip === true);
});

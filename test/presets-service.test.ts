/* Presets: applying one, and what travels when one is shared.
 *
 * A real library in a temp folder; the installer, the catalog and the schema service are stand-ins
 * that record what they were asked, because the question here is what gets decided about the
 * records, not whether a VPK is written (test/packs.test.ts and test/installer.test.js do that).
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Library } from '../src/library.ts';
import { presetsService, packableRecord, touchesSchema, type PresetInstaller } from '../src/presets-service.ts';
import { encodePresetLink } from '../src/preset-link.ts';
import type { LibRecord } from '../src/types.ts';

const CATALOG = {
  mods: {
    modsData: {
      heroes: [{ name: 'Alien Nyx Assassin', file: 'nyx.zip' }],
      trees: [{ name: 'Pumpkin Trees', file: 'pumpkin.zip' }],
    },
  },
};

/** A library with three mods, services that record their calls, and the presets over them.
 * The installer refuses to switch the mod named `failOn`. */
function stand(t: TestContext, { failOn = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-presets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  const calls: string[] = [];
  const add = (name: string, categoryId: string) => library.add({
    name, categoryId, styleLabel: null, fileRef: null, preview: null,
    files: [{ root: 'lang', relPath: `${name.replace(/\W/g, '')}_dir.vpk` }],
  });
  const nyx = add('Alien Nyx Assassin', 'heroes');
  const trees = add('Pumpkin Trees', 'trees');
  const mine = add('My Own Import', 'imported');
  const installer = {
    setEnabled: (_files: unknown, on: boolean, id: string) => {
      if (library.find(id)?.name === failOn) throw new Error('the file is in use');
      calls.push(`${on ? 'on' : 'off'} ${library.find(id)?.name}`);
    },
    analyzeRecord: () => null,
  } as unknown as PresetInstaller;
  const schemaService = { refresh: () => calls.push('refresh') };
  const svc = presetsService({ catalog: { load: async () => CATALOG } as never, installer, library, schemaService, deployAndApply: () => [] });
  return { library, svc, calls, nyx, trees, mine };
}

test('applying a preset turns off what it does not name before turning on what it does', (t) => {
  /* Two cursor sets cannot be live at once, so the outgoing one has to put the vanilla files back
     before the incoming one writes over them. */
  const s = stand(t);
  s.library.setEnabled(s.trees.id, false);
  s.library.savePreset('Just trees');
  const preset = s.library.listPresets()[0];
  s.library.setEnabled(s.trees.id, true);
  s.library.setEnabled(s.nyx.id, false);
  s.library.setEnabled(s.mine.id, true);

  // the preset was saved with nyx and mine on and trees off; now it is the other way round
  const errors = s.svc.applyPreset(preset);

  assert.deepEqual(errors, []);
  assert.deepEqual(s.calls, ['off Pumpkin Trees', 'on Alien Nyx Assassin']);
  assert.equal(s.library.find(s.trees.id)?.enabled, false);
  assert.equal(s.library.find(s.nyx.id)?.enabled, true);
});

test('a mod that cannot be switched is named, and the rest of the preset still applies', (t) => {
  const s = stand(t, { failOn: 'Alien Nyx Assassin' });
  s.library.savePreset('All on');
  const preset = s.library.listPresets()[0];
  s.library.setEnabled(s.nyx.id, false);
  s.library.setEnabled(s.trees.id, false);

  const errors = s.svc.applyPreset(preset);

  assert.deepEqual(errors, ['Alien Nyx Assassin: the file is in use']);
  assert.equal(s.library.find(s.trees.id)?.enabled, true, 'the one that could be switched was');
  assert.equal(s.library.find(s.nyx.id)?.enabled, false, 'the one that failed kept its state');
});

test('a link carries the catalog mods and names the ones it had to leave out', async (t) => {
  const s = stand(t);
  s.library.savePreset('Build');
  const cat = await s.svc.catalogIndex();
  const { mods, skipped } = s.svc.presetLinkMods(s.library.listPresets()[0], cat);
  assert.deepEqual(mods.map((m) => m.name).sort(), ['Alien Nyx Assassin', 'Pumpkin Trees']);
  assert.deepEqual(skipped, ['My Own Import'], 'an import has no way to reach the other side by link');
});

test('a received link parks as a wish list, and its status says what installing would do', async (t) => {
  const s = stand(t);
  const { direct } = encodePresetLink({
    name: 'From a friend', author: 'friend',
    mods: [
      { categoryId: 'heroes', name: 'Alien Nyx Assassin' },
      { categoryId: 'trees', name: 'Pumpkin Trees' },
      { categoryId: 'river', name: 'Not In Any Catalog' },
    ],
  });
  s.library.removeRecord(s.trees.id);

  const got = s.svc.importPresetLink(direct);
  assert.ok('ok' in got, 'the link was refused');
  const status = await s.svc.sharedPresetStatus(got.preset, await s.svc.catalogIndex());
  assert.deepEqual(status, { installed: 1, download: 1, embedded: 0, free: 0, unavailable: ['Not In Any Catalog'] });
  assert.equal(s.calls.length, 0, 'nothing was installed or switched by receiving it');
});

test('a link that is not one is an error the window can show, not an exception', (t) => {
  const s = stand(t);
  const got = s.svc.importPresetLink('https://example.com/not-a-preset');
  assert.ok('error' in got && got.error.length > 0);
});

test('what can go into a pack, and what makes the item table rebuild', () => {
  const rec = (over: Partial<LibRecord>): LibRecord => ({ id: 'x', name: 'X', categoryId: 'heroes', files: [{ root: 'lang', relPath: 'pak30_dir.vpk' }], ...over });
  assert.equal(packableRecord(rec({})), true);
  assert.equal(packableRecord(rec({ kind: 'pack' })), false, 'a pack does not go into another pack');
  assert.equal(packableRecord(rec({ categoryId: 'fonts' })), false);
  assert.equal(packableRecord(rec({ files: [{ root: 'cursor', relPath: 'arrow.cur' }] })), false, 'loose files are not a pak');
  assert.equal(packableRecord(null), false);

  assert.equal(touchesSchema(rec({ categoryId: 'cosmetic' })), true);
  assert.equal(touchesSchema(rec({ schema: [{ id: '1', name: 'a', block: '"1"{}' }] })), true);
  assert.equal(touchesSchema(rec({})), false);
});

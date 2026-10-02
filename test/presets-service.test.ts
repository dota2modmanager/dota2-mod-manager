/* Presets: applying one, and what travels when one is shared.
 *
 * A real library in a temp folder; the installer, the catalog and the schema service are stand-ins
 * that record what they were asked, because the question here is what gets decided about the
 * records, not whether a VPK is written (test/packs.test.ts and test/installer.test.ts do that).
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Library } from '../src/library.ts';
import { presetsService, packableRecord, touchesSchema, type PresetInstaller } from '../src/presets-service.ts';
import { encodePresetLink } from '../src/preset-link.ts';
import { writePresetFile } from '../src/preset-share.ts';
import { withElectron } from './helpers/fake-electron.ts';
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

// ---------- what goes into a shared file ----------

/** A library over a real language folder and pack folder, with an installer that answers from them. */
function shareStand(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-share-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lang = path.join(dir, 'game', 'dota_russian');
  const packs = path.join(dir, 'userdata', 'packs');
  fs.mkdirSync(lang, { recursive: true });
  const library = new Library(path.join(dir, 'userdata'));
  const merged: string[] = [];
  const deployed: string[] = [];
  const removed: string[] = [];
  const fps: Record<string, string> = {};
  const installer: PresetInstaller = {
    analyzeRecord: (rec) => ({ fp: fps[rec.name] || null, info: `${rec.name} info` }),
    langFolder: () => lang,
    mergeToSingleVpk: (rec) => { merged.push(rec.name); return Buffer.from('merged'); },
    packMemberFile: (packId, memberId) => path.join(packs, packId, `${memberId}.vpk`),
    packFolder: (packId) => path.join(packs, packId),
    addPackMemberFromRecord: (_packId, rec, memberId) => ({ id: memberId, name: rec.name, categoryId: rec.categoryId, styleLabel: rec.styleLabel }),
    remove: (files) => { removed.push(...files.map((f) => f.relPath)); },
    setEnabled: () => {},
  };
  const svc = presetsService({
    catalog: { load: async () => CATALOG } as never, installer, library,
    schemaService: { refresh: () => {} }, deployAndApply: (pack) => { deployed.push(pack.name); return []; },
  });
  const add = (name: string, categoryId: string, rel: string | null) => library.add({
    name, categoryId, styleLabel: null, fileRef: null, preview: null,
    files: rel ? [{ root: rel.endsWith('.ttf') ? 'fonts' : 'lang', relPath: rel }] : [],
  });
  return { dir, lang, packs, library, svc, merged, deployed, removed, fps, add };
}

test('a shared preset sends catalog mods by name, the user\'s own as bytes, and names what it cannot send', async (t) => {
  const s = shareStand(t);
  s.fps['Alien Nyx Assassin'] = 'fp-nyx';
  s.add('Alien Nyx Assassin', 'heroes', 'pak30_dir.vpk');
  s.add('My Own Import', 'imported', 'pak31_dir.vpk');
  // switched off, so the bytes sit under .off: the size is read from there
  fs.writeFileSync(path.join(s.lang, 'pak31_dir.vpk.off'), Buffer.alloc(1234));
  s.add('A Font', 'fonts', 'radiance.ttf');
  const pack = s.library.add({ name: 'My pack', categoryId: 'combined', styleLabel: null, fileRef: null, preview: null, files: [], kind: 'pack',
    members: [
      { id: 'm1', name: 'Pumpkin Trees', categoryId: 'trees', styleLabel: null, fp: 'fp-trees' },
      { id: 'm2', name: 'Own Member', categoryId: 'imported', info: 'one hero' },
      { id: 'm3', name: 'Lost Member', categoryId: 'imported' },
    ] });
  fs.mkdirSync(path.join(s.packs, pack.id), { recursive: true });
  fs.writeFileSync(path.join(s.packs, pack.id, 'm2.vpk'), Buffer.alloc(50));
  s.library.savePreset('Everything');

  const entries = await s.svc.presetShareEntries(s.library.listPresets()[0]);
  const byName = new Map(entries.map((e) => [e.name, e]));
  assert.deepEqual(byName.get('Alien Nyx Assassin'), { kind: 'catalog', categoryId: 'heroes', name: 'Alien Nyx Assassin', styleLabel: null, fp: 'fp-nyx', size: 0 });
  const own = byName.get('My Own Import');
  assert.equal(own?.kind, 'embedded');
  assert.equal(own?.kind === 'embedded' && own.size, 1234);
  assert.deepEqual(s.merged, [], 'nothing is merged just to show the plan');
  assert.equal(own?.kind === 'embedded' && own.loadData().toString(), 'merged');
  assert.deepEqual(s.merged, ['My Own Import'], 'the bytes are made when the file is written');
  assert.equal(byName.get('A Font')?.kind, 'missing', 'a font is not in the catalog and is no VPK to carry');

  const packed = byName.get('My pack');
  assert.equal(packed?.kind, 'pack');
  assert.deepEqual(packed?.kind === 'pack' && packed.members.map((m) => [m.kind, m.name, 'size' in m ? m.size : null]), [
    ['catalog', 'Pumpkin Trees', 0], ['embedded', 'Own Member', 50], ['missing', 'Lost Member', null],
  ]);

  // what the window is shown: no loaders, and a key per row to leave one out by
  const plan = s.svc.planShape(entries);
  assert.ok(plan.every((row) => !('loadData' in row)));
  const packRow = plan.find((row) => row.name === 'My pack');
  assert.deepEqual(packRow?.members?.map((m) => m.key), [`${packRow?.key}.0`, `${packRow?.key}.1`, `${packRow?.key}.2`]);
  assert.equal(plan.find((row) => row.name === 'My Own Import')?.size, 1234);
});

test('a received preset says what is already here, what downloads, what it carries and what is free', async (t) => {
  const s = shareStand(t);
  s.add('Alien Nyx Assassin', 'heroes', 'pak30_dir.vpk');
  const own = s.add('Already Here', 'imported', 'pak31_dir.vpk');
  s.fps[own.name] = 'fp-here';
  const cosmetic = s.library.add({ name: 'Snow', categoryId: 'cosmetic', styleLabel: null, fileRef: null, preview: null, files: [] });
  s.library.update(cosmetic.id, { slot: 'weather', itemId: '4000' });

  const preset = s.library.addSharedPreset({ name: 'From a friend', note: '', author: 'friend', wanted: [
    { kind: 'catalog', categoryId: 'heroes', name: 'Alien Nyx Assassin', styleLabel: null },
    { kind: 'catalog', categoryId: 'trees', name: 'Pumpkin Trees', styleLabel: null },
    { kind: 'catalog', categoryId: 'river', name: 'Gone From The Catalog', styleLabel: null },
    { kind: 'embedded', name: 'Theirs, which I have', categoryId: 'imported', fp: 'fp-here', file: 'a.vpk' },
    { kind: 'embedded', name: 'Theirs, new to me', categoryId: 'imported', fp: 'fp-new', file: 'b.vpk' },
    { kind: 'cosmetic', name: 'Snow', slot: 'weather', itemId: '4000' },
    { kind: 'cosmetic', name: 'Rain', slot: 'weather', itemId: '4001' },
    { kind: 'pack', name: 'Their pack', members: [{ kind: 'catalog', categoryId: 'trees', name: 'Pumpkin Trees', styleLabel: null }] },
  ] as never });

  assert.deepEqual(await s.svc.sharedPresetStatus(preset, await s.svc.catalogIndex()), {
    installed: 3, download: 2, embedded: 1, free: 1, unavailable: ['Gone From The Catalog'],
  });
});

test('received mods are packed into one slot only when there are two or more that can be', (t) => {
  const s = shareStand(t);
  const a = s.add('First', 'imported', 'pak30_dir.vpk');
  const b = s.add('Second', 'imported', 'pak31_dir.vpk');
  const font = s.add('A Font', 'fonts', 'radiance.ttf');
  assert.equal(s.svc.packFromRecords('Alone', [a.id, font.id]), null, 'one packable mod is left standalone');

  const pack = s.svc.packFromRecords('From a friend', [a.id, b.id]) as LibRecord;
  assert.deepEqual(pack.members?.map((m) => m.name), ['First', 'Second']);
  assert.equal(s.library.find(a.id), null);
  assert.equal(s.library.find(b.id), null);
  assert.deepEqual(s.removed, ['pak30_dir.vpk', 'pak31_dir.vpk'], 'the standalone files go once they are in the pack');
  assert.deepEqual(s.deployed, ['From a friend']);
  assert.ok(fs.existsSync(path.join(s.packs, pack.id)));
});

test('a received file parks as a preset, keeping the archive only when it carries mods of its own', (t) => {
  const s = shareStand(t);
  const userData = path.join(s.dir, 'userdata');
  const fakeElectron = { app: { getPath: () => userData } };
  const file = (name: string, mods: unknown[]) => {
    const out = path.join(s.dir, `${name}.d2mm`);
    writePresetFile(out, { name, author: { name: 'friend' } }, mods as never);
    return out;
  };
  const withOwn = file('With own', [
    { kind: 'catalog', categoryId: 'heroes', name: 'Alien Nyx Assassin', styleLabel: null, fp: null },
    { kind: 'embedded', name: 'Their mod', categoryId: 'imported', data: Buffer.from('vpk bytes') },
  ]);
  const got = withElectron(fakeElectron, () => s.svc.importPresetFile(withOwn));
  assert.ok('ok' in got, 'error' in got ? got.error : '');
  const kept = got.preset.source?.file as string;
  assert.ok(kept && kept.startsWith(path.join(userData, 'shared-presets')), 'the archive is kept: its bytes live nowhere else');
  assert.ok(fs.existsSync(kept));
  s.svc.dropSharedPresetFile(got.preset);
  assert.equal(fs.existsSync(kept), false);

  const byName = withElectron(fakeElectron, () => s.svc.importPresetFile(file('By name', [
    { kind: 'catalog', categoryId: 'heroes', name: 'Alien Nyx Assassin', styleLabel: null, fp: null },
  ])));
  assert.ok('ok' in byName);
  assert.ok(!byName.preset.source?.file, 'nothing to keep for mods the catalog has');

  const empty = withElectron(fakeElectron, () => s.svc.importPresetFile(file('Empty', [])));
  assert.ok('error' in empty && empty.error.length > 0);
  fs.writeFileSync(path.join(s.dir, 'junk.d2mm'), 'not a zip');
  const junk = withElectron(fakeElectron, () => s.svc.importPresetFile(path.join(s.dir, 'junk.d2mm')));
  assert.ok('error' in junk && junk.error.length > 0, 'a broken file is an error the window can show');
  assert.equal(s.library.listPresets().length, 2, 'only the two good files became presets');
});

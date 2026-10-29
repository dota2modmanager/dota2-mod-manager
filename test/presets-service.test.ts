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
import { presetIsOn, presetsService, packableRecord, touchesSchema, type PresetInstaller } from '../src/presets-service.ts';
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
  // a look put on is a record in its slot, as schema-cosmetics pickCosmetic makes it
  const schemaService = {
    refreshInBackground: async () => { calls.push('refresh'); },
    pickCosmetic: (slot: string, itemId: string, name: string, effectId: string) => {
      calls.push(`pick ${slot} ${itemId}${effectId ? ` ${effectId}` : ''}`);
      for (const r of library.list()) if (r.categoryId === 'cosmetic' && r.slot === slot) library.setEnabled(r.id, false);
      const rec = library.add({ name, categoryId: 'cosmetic', styleLabel: null, fileRef: null, preview: null, files: [] });
      library.update(rec.id, { slot, itemId, effectId: effectId || undefined });
      return library.find(rec.id);
    },
  };
  const values: Record<string, unknown> = {};
  const settings = { get: (k: string) => values[k], set: (k: string, v: unknown) => { values[k] = v; } } as never;
  const svc = presetsService({ catalog: { load: async () => CATALOG } as never, installer, library, schemaService, deployAndApply: () => [], settings });
  /** a look picked the way the window picks one */
  const pick = (slot: string, itemId: string, name: string, effectId = '') => schemaService.pickCosmetic(slot, itemId, name, effectId);
  return { library, svc, calls, nyx, trees, mine, pick };
}

test('applying a preset turns off what it does not name before turning on what it does', async (t) => {
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
  const errors = await s.svc.applyPreset(preset);

  assert.deepEqual(errors, []);
  assert.deepEqual(s.calls, ['off Pumpkin Trees', 'on Alien Nyx Assassin']);
  assert.equal(s.library.find(s.trees.id)?.enabled, false);
  assert.equal(s.library.find(s.nyx.id)?.enabled, true);
});

test('a mod that cannot be switched is named, and the rest of the preset still applies', async (t) => {
  const s = stand(t, { failOn: 'Alien Nyx Assassin' });
  s.library.savePreset('All on');
  const preset = s.library.listPresets()[0];
  s.library.setEnabled(s.nyx.id, false);
  s.library.setEnabled(s.trees.id, false);

  const errors = await s.svc.applyPreset(preset);

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
  assert.equal(touchesSchema(rec({ generated: { set: 'terrorblade-arcana', color: [0, 0, 255], mode: 'mod' } })), true, "the arcana window's colour is the builder's base's");
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
    schemaService: { refreshInBackground: async () => {}, pickCosmetic: () => null }, deployAndApply: (pack) => { deployed.push(pack.name); return []; },
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

// ---------- the looks in a preset (issue #284) ----------

test('a preset keeps the looks that were on, and applying it puts each back in its slot and switches every other look off', async (t) => {
  const s = stand(t);
  s.pick('item:juggernaut:body', '9059', 'Bladeform Legacy', 'style-1');
  s.pick('weather', '4000', 'Weather Snow');
  s.library.savePreset('Jugg in the snow');
  const preset = s.library.listPresets()[0];
  assert.deepEqual(preset.picks, [
    { slot: 'item:juggernaut:body', itemId: '9059', name: 'Bladeform Legacy', effectId: 'style-1' },
    { slot: 'weather', itemId: '4000', name: 'Weather Snow', effectId: '' },
  ], 'slot, item and effects, as the builder put them on');
  assert.ok(!(preset.mods || []).some((m) => m.categoryId === 'cosmetic'), 'and not among the mods');

  // later: another sword of weather, and a courier the preset never heard of
  s.pick('weather', '4001', 'Weather Rain');
  s.pick('courier', '700', 'Golden Courier');
  s.calls.length = 0;
  assert.deepEqual(await s.svc.applyPreset(preset), []);
  const on = (slot: string) => s.library.list().find((r) => r.categoryId === 'cosmetic' && r.slot === slot && r.enabled !== false);
  assert.equal(on('weather')?.itemId, '4000', 'its weather back');
  assert.equal(on('item:juggernaut:body')?.effectId, 'style-1');
  assert.equal(on('courier'), undefined, 'a preset of 20 is 20: the courier it does not name goes off');
  assert.ok(s.library.list().some((r) => r.slot === 'courier' && r.itemId === '700'), 'switched off, not deleted: My mods still has it');
  assert.equal(s.calls.at(-1), 'refresh', 'and the table built once, at the end');

  // a preset saved with no looks on at all puts every look off
  s.library.savePreset('Bare');
  s.pick('courier', '700', 'Golden Courier');
  const bare = s.library.listPresets().find((p) => p.name === 'Bare')!;
  bare.picks = [];
  await s.svc.applyPreset(bare);
  assert.equal(s.library.list().filter((r) => r.categoryId === 'cosmetic' && r.enabled !== false).length, 0);
});

test('a preset saved before it kept looks leaves every look as it is, and the remote switch keeps them off', async (t) => {
  const s = stand(t);
  s.pick('weather', '4000', 'Weather Snow');
  s.library.savePreset('Old');
  const preset = s.library.listPresets()[0];
  delete preset.picks;
  s.pick('weather', '4001', 'Weather Rain');
  await s.svc.applyPreset(preset);
  const on = () => s.library.list().find((r) => r.categoryId === 'cosmetic' && r.slot === 'weather' && r.enabled !== false);
  assert.equal(on()?.itemId, '4001', 'nothing to say about looks, nothing done to them');

  s.library.savePreset('Old');
  s.pick('weather', '4000', 'Weather Snow');
  await s.svc.applyPreset(s.library.listPresets()[0], { picks: false });
  assert.equal(on()?.itemId, '4000', 'looks switched off remotely: the preset applies its mods only');
});

test('the looks travel with a preset, in its file and in its link', async (t) => {
  const s = stand(t);
  s.pick('item:juggernaut:body', '9059', 'Bladeform Legacy');
  s.library.savePreset('Build');
  const preset = s.library.listPresets()[0];
  const entries = await s.svc.presetShareEntries(preset);
  assert.deepEqual(entries.filter((e) => e.kind === 'cosmetic'), [{ kind: 'cosmetic', slot: 'item:juggernaut:body', itemId: '9059', name: 'Bladeform Legacy', effectId: '' }]);
  const link = s.svc.presetLinkMods(preset, await s.svc.catalogIndex());
  assert.ok(link.mods.some((m) => m.kind === 'cosmetic' && m.itemId === '9059'), 'a link carries it too: a slot and an item');
});

test('a look the game no longer has is named, and the rest of the preset still goes on', async (t) => {
  const s = stand(t);
  s.pick('weather', '4000', 'Weather Snow');
  s.pick('courier', '999', 'A Courier Valve Removed');
  s.library.savePreset('Build');
  const preset = s.library.listPresets()[0];
  const gone = presetsService({
    catalog: { load: async () => CATALOG } as never,
    installer: { setEnabled: () => {}, analyzeRecord: () => null } as unknown as PresetInstaller,
    library: s.library,
    schemaService: {
      refreshInBackground: async () => {},
      pickCosmetic: (slot: string, itemId: string) => { if (itemId === '999') throw new Error('items_game: the item is not there'); return null; },
    },
    deployAndApply: () => [],
  });
  assert.deepEqual(await gone.applyPreset(preset), ['A Courier Valve Removed: items_game: the item is not there']);
});

// ---------- which preset you are in ----------

test('the preset you are in is the one whose mods and looks are exactly what is on; the one applied last says it changed', async (t) => {
  const s = stand(t);
  s.pick('weather', '4000', 'Weather Snow');
  s.library.savePreset('All three');
  s.library.setEnabled(s.trees.id, false);
  s.library.savePreset('No trees');
  const [all, noTrees] = s.library.listPresets();
  assert.deepEqual([s.svc.presetState(all), s.svc.presetState(noTrees)], [null, 'active'], 'the state as it is: no trees');

  await s.svc.applyPreset(all);
  assert.deepEqual([s.svc.presetState(all), s.svc.presetState(noTrees)], ['active', null]);

  s.library.setEnabled(s.nyx.id, false);
  assert.equal(s.svc.presetState(all), 'changed', 'applied last, a mod switched off since');
  s.library.setEnabled(s.nyx.id, true);
  s.pick('weather', '4001', 'Weather Rain');
  assert.equal(s.svc.presetState(all), 'changed', 'another look is a change too');

  // a preset that kept no looks says nothing about them, and a member not installed is not asked
  const old = { ...all, picks: undefined };
  assert.equal(presetIsOn(s.library, old), true);
  s.library.removeRecord(s.mine.id);
  s.pick('weather', '4000', 'Weather Snow');
  assert.equal(presetIsOn(s.library, all), true, 'My Own Import is gone: what is here of the preset is all on');
  await s.svc.applyPreset(noTrees);
  s.library.removeRecord(s.trees.id);
  s.library.setEnabled(s.nyx.id, false);
  const gone = { ...noTrees, id: 'gone', picks: [] };
  gone.mods = (noTrees.mods || []).filter((m) => m.name !== 'Alien Nyx Assassin');
  s.pick('weather', '4000', 'Weather Snow');
  s.library.setEnabled(s.library.list().find((r) => r.slot === 'weather')!.id, false);
  assert.equal(s.svc.presetState(gone), null, 'none of it installed and never applied: not the one you are in');
});

/* What the installer does to mods already in the folder (src/installer-repack.ts): folding an old
 * multi-volume import into one file, cutting a pack of several heroes into one mod each, merging a
 * mod into one file for export with its item blocks put back, naming it after the game's own items,
 * and how much room it takes. The first two rename and write files in the game folder; until these
 * tests nothing ran them except by hand.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import * as vpk from '../src/vpk.ts';
import { entry } from './helpers/vpk-entry.ts';

/** A game folder with an installer and a library over it. */
function stand(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-repack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), "the game's own archive");
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  /** A mod as an old import left it: <slot>_dir.vpk over <slot>_000.vpk, _001.vpk... */
  const multiPart = (slot: string, files: [string, string][][]) => {
    const members = files.map((list, i) => ({ key: String(i), buf: vpk.buildVpk(list.map(([p, b]) => entry(p, b))) }));
    return vpk.combineVpksToFiles(members, lang, slot, { volumeCap: 1 });
  };
  const files = () => fs.readdirSync(lang).sort();
  return { dir, lang, installer, library, multiPart, files };
}

test('an old import kept as an index and data volumes is folded into one file, switched-off state and all', async (t) => {
  const s = stand(t);
  const out = s.multiPart('pak30', [[['models/heroes/pudge/pudge.vmdl_c', 'body']], [['materials/pudge.vmat_c', 'skin']]]);
  assert.deepEqual(out.parts, ['pak30_000.vpk', 'pak30_001.vpk']);
  // the mod was switched off, which renames every file it lists
  for (const f of ['pak30_dir.vpk', 'pak30_000.vpk', 'pak30_001.vpk']) fs.renameSync(path.join(s.lang, f), path.join(s.lang, `${f}.off`));
  const rec = s.library.add({ name: 'Old import', categoryId: 'imported', fileRef: 'x', files: [
    { root: 'lang', relPath: 'pak30_dir.vpk' }, { root: 'lang', relPath: 'pak30_000.vpk' }, { root: 'lang', relPath: 'pak30_001.vpk' },
  ] } as never);

  s.installer.mergeMultiPartRecords(s.library);
  assert.deepEqual(s.files(), ['pak30_dir.vpk.off'], 'one file, still off');
  assert.deepEqual(s.library.find(rec.id)!.files, [{ root: 'lang', relPath: 'pak30_dir.vpk' }]);
  const merged = fs.readFileSync(path.join(s.lang, 'pak30_dir.vpk.off'));
  const bytes = Object.fromEntries(vpk.readVpkEntries(merged, 'mem').map((e) => [vpk.entryPath(e), e.data.toString()]));
  assert.deepEqual(bytes, { 'models/heroes/pudge/pudge.vmdl_c': 'body', 'materials/pudge.vmat_c': 'skin' });
});

test('a set with a volume missing is left exactly as it is, and so is a pack', async (t) => {
  const s = stand(t);
  s.multiPart('pak30', [[['models/heroes/pudge/pudge.vmdl_c', 'body']], [['materials/pudge.vmat_c', 'skin']]]);
  fs.rmSync(path.join(s.lang, 'pak30_001.vpk'));
  const broken = s.library.add({ name: 'Broken', categoryId: 'imported', fileRef: 'x', files: [
    { root: 'lang', relPath: 'pak30_dir.vpk' }, { root: 'lang', relPath: 'pak30_000.vpk' }, { root: 'lang', relPath: 'pak30_001.vpk' },
  ] } as never);
  s.multiPart('pak40', [[['models/heroes/axe/axe.vmdl_c', 'a']], [['models/heroes/lina/lina.vmdl_c', 'b']]]);
  const pack = s.library.add({ kind: 'pack', name: 'A pack', categoryId: 'combined', fileRef: null, files: [
    { root: 'lang', relPath: 'pak40_dir.vpk' }, { root: 'lang', relPath: 'pak40_000.vpk' }, { root: 'lang', relPath: 'pak40_001.vpk' },
  ] } as never);
  const before = s.files();

  s.installer.mergeMultiPartRecords(s.library);
  assert.deepEqual(s.files(), before);
  assert.equal(s.library.find(broken.id)!.files.length, 3);
  assert.equal(s.library.find(pack.id)!.files.length, 3, 'a pack\'s volumes are how it is written');
});

test('a pack of two heroes in the folder is cut into one mod each, in free slots, and the source is left to the caller', async (t) => {
  const s = stand(t);
  fs.writeFileSync(path.join(s.lang, 'pak30_dir.vpk'), 'a mod already in slot 30');
  fs.writeFileSync(path.join(s.lang, 'skins_dir.vpk'), vpk.buildVpk([
    entry('models/heroes/pudge/pudge.vmdl_c', 'pudge body'),
    entry('models/items/pudge/arcana/pudge_arcana_head.vmdl_c', 'pudge head'),
    entry('models/heroes/juggernaut/juggernaut.vmdl_c', 'jugg body'),
    entry('models/items/juggernaut/arcana/jugg_arcana_weapon.vmdl_c', 'jugg sword'),
    entry('materials/shared/sky.vmat_c', 'shared'),
  ]));

  const parts = s.installer.splitVpkFile('skins_dir.vpk');
  assert.deepEqual(parts.map((p) => p.name).sort(), ['Juggernaut', 'Pudge']);
  const slots = parts.map((p) => p.files[0].relPath);
  assert.ok(!slots.includes('pak30_dir.vpk'), 'a slot somebody holds is not taken');
  assert.equal(new Set(slots).size, 2);
  for (const p of parts) {
    const paths = vpk.listVpkPaths(fs.readFileSync(path.join(s.lang, p.files[0].relPath)));
    assert.ok(paths.includes('materials/shared/sky.vmat_c'), `${p.name} stands alone with the shared files`);
    assert.ok(p.paths.every((x) => x.includes(p.name === 'Pudge' ? 'pudge' : 'jugg')), `${p.name} owns only its own files`);
  }
  assert.ok(s.files().includes('skins_dir.vpk'), 'deleting the source is the caller\'s step');

  fs.writeFileSync(path.join(s.lang, 'solo_dir.vpk'), vpk.buildVpk([entry('models/heroes/axe/axe.vmdl_c', 'axe')]));
  assert.deepEqual(s.installer.splitVpkFile('solo_dir.vpk'), [], 'one hero is not a pack');
});

test('a mod merged for export carries its item blocks in place of the table it shipped, even while switched off', async (t) => {
  const s = stand(t);
  fs.writeFileSync(path.join(s.lang, 'pak30_dir.vpk.off'), vpk.buildVpk([
    entry('models/heroes/pudge/pudge.vmdl_c', 'body'),
    entry('scripts/items/items_game.txt', 'the whole game table the mod shipped'),
  ]));
  const rec = { files: [{ root: 'lang' as const, relPath: 'pak30_dir.vpk' }] };

  const plain = vpk.readVpkEntries(s.installer.mergeToSingleVpk(rec), 'mem');
  assert.equal(plain.find((e) => vpk.entryPath(e) === 'scripts/items/items_game.txt')!.data.toString(), 'the whole game table the mod shipped');

  const withBlocks = vpk.readVpkEntries(s.installer.mergeToSingleVpk(rec, [{ block: '"9999" { "name" "an effect" }' }]), 'mem');
  const table = withBlocks.filter((e) => vpk.entryPath(e) === 'scripts/items/items_game.txt');
  assert.equal(table.length, 1, 'one table, not two');
  assert.match(table[0].data.toString('latin1'), /"9999" \{ "name" "an effect" \}/);
  assert.ok(withBlocks.some((e) => vpk.entryPath(e) === 'models/heroes/pudge/pudge.vmdl_c'));

  assert.throws(() => s.installer.mergeToSingleVpk({ files: [{ root: 'fonts', relPath: 'a.ttf' }] }), /_dir\.vpk/);
});

test('a mod the game\'s own table recognises is named by its items, a few in full and the rest counted', async (t) => {
  const s = stand(t);
  const paths = ['models/heroes/pudge/pudge.vmdl_c'];
  const analysis = vpk.analyzeVpkPaths(paths);
  s.installer.identify = () => ({ items: ['Hook', 'Belt', 'Cleaver'], heroNames: ['Pudge'] }) as never;
  assert.equal(s.installer.describePaths(paths, analysis).info, 'Hook, Belt, Cleaver');
  s.installer.identify = () => ({ items: ['Hook', 'Belt', 'Cleaver', 'Back', 'Arms'], heroNames: ['Pudge', 'Lina'] }) as never;
  const told = s.installer.describePaths(paths, analysis);
  assert.equal(told.info, 'Hook, Belt +3');
  assert.deepEqual(told.heroNames.sort(), ['Lina', 'Pudge'], 'a hero the table names is one the mod is for');
  s.installer.identify = () => { throw new Error('no game table'); };
  assert.equal(s.installer.describePaths(paths, analysis).info, vpk.describeAnalysis(analysis), 'without the table the guess stands');
});

test('the room a mod takes is its paks in the language folder, whatever else it lists', async (t) => {
  const s = stand(t);
  fs.writeFileSync(path.join(s.lang, 'pak30_dir.vpk'), Buffer.alloc(100));
  fs.writeFileSync(path.join(s.lang, 'pak30_000.vpk'), Buffer.alloc(50));
  assert.equal(s.installer.installedSize({ files: [
    { root: 'lang', relPath: 'pak30_dir.vpk' }, { root: 'lang', relPath: 'pak30_000.vpk' },
    { root: 'lang', relPath: 'gone_dir.vpk' }, { root: 'fonts', relPath: 'big.ttf' },
  ] }), 150);
});

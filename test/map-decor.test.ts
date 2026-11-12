/* The map without its decor (src/map-decor.ts): the decor materials are read off the map in force
 * and the models it names, each group becomes copies of the game's blank material, and the record
 * in My mods is built again after an update. The map and pak01 here are small paks with the names
 * the game's have; Valve's own files cannot be committed. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, openVpkIndex } from '../src/vpk.ts';
import { BLANK, clampGroups, createMapDecor, decorMaterialsSteps, decorPak } from '../src/map-decor.ts';
import { drain } from '../src/steps.ts';

const BLANK_BYTES = Buffer.from('blank material');
const names = (...p: string[]) => Buffer.from(p.join('\0'));

/** The game's pak01 and map: a flower baked into a world mesh, a fern model on its own, a tree, a building. */
function game(dir: string, mapExtra: string[] = []) {
  const g = path.join(dir, 'game');
  fs.mkdirSync(path.join(g, 'dota', 'maps'), { recursive: true });
  fs.mkdirSync(path.join(g, 'dota_russian'), { recursive: true });
  const mats = ['models/props_nature/flowers001', 'models/props_nature/fern001', 'models/props_debris/barrel001', 'models/props_tree/tree_oak_00', 'models/props_structures/good_base', 'nature/card_grass_default_001', 'overlays/blood001', 'blends/mod_radiant_000'];
  fs.writeFileSync(path.join(g, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt(BLANK, BLANK_BYTES),
    ...mats.map((m) => entryAt(`materials/${m}.vmat_c`, Buffer.from(m))),
    entryAt('models/props_nature/fern001.vmdl_c', names('materials/models/props_nature/fern001.vmat')),
  ]));
  fs.writeFileSync(path.join(g, 'dota', 'maps', 'dota.vpk'), buildVpk([
    entryAt('maps/dota/worldnodes/n0_lr0_agg_prop_flowers_0.vmdl_c', names('materials/models/props_nature/flowers001.vmat', 'materials/Models/Props_Debris/barrel001.vmat')),
    entryAt('maps/dota/worldnodes/n0.vwnod_c', names('models/props_nature/fern001.vmdl', 'materials/models/props_tree/tree_oak_00.vmat', 'materials/models/props_structures/good_base.vmat')),
    entryAt('maps/dota.vmap_c', names('materials/nature/card_grass_default_001.vmat', 'materials/overlays/blood001.vmat', 'materials/blends/mod_radiant_000.vmat', 'materials/models/props_nature/gone_from_pak01.vmat', ...mapExtra)),
  ]));
  return g;
}

test('the decor is read off the map and its models, and nothing a player plays around is taken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-decor-'));
  try {
    const g = game(dir);
    const pak = openVpkIndex(path.join(g, 'dota', 'pak01_dir.vpk'));
    const mats = drain(decorMaterialsSteps(openVpkIndex(path.join(g, 'dota', 'maps', 'dota.vpk')), pak));
    assert.deepEqual(mats, {
      // the fern only through its model; a material pak01 does not have is left out
      plants: ['materials/models/props_nature/fern001.vmat', 'materials/models/props_nature/flowers001.vmat', 'materials/nature/card_grass_default_001.vmat'],
      debris: ['materials/models/props_debris/barrel001.vmat', 'materials/overlays/blood001.vmat'],
    });
    fs.writeFileSync(path.join(dir, 'out_dir.vpk'), decorPak(pak, mats, ['debris']));
    const out = openVpkIndex(path.join(dir, 'out_dir.vpk'));
    assert.deepEqual([...out.paths()].sort(), ['materials/models/props_debris/barrel001.vmat_c', 'materials/overlays/blood001.vmat_c']);
    assert.deepEqual(out.read('materials/overlays/blood001.vmat_c'), BLANK_BYTES);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('what the window sends is kept to the two groups', () => {
  assert.deepEqual(clampGroups(['debris', 'plants', 'debris', 'trees']), ['plants', 'debris']);
  assert.deepEqual(clampGroups('plants'), []);
});

function world(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-decor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const g = game(dir);
  const userdata = path.join(dir, 'userdata');
  const installer = new Installer({ userDataDir: userdata, getGamePath: () => g, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(userdata);
  const rebuilt: string[] = [];
  const service = createMapDecor({ gamePath: () => g, installer, library, onRebuilt: (id) => rebuilt.push(id) });
  const pak = (rec: { files: { relPath: string }[] }) => openVpkIndex(path.join(installer.langFolder(), rec.files[0].relPath));
  return { g, service, library, installer, rebuilt, pak };
}

test('a look is one record in Optimization, built again in its slot with other groups', async (t) => {
  const w = world(t);
  assert.deepEqual(await w.service.state(), { installed: null, counts: { plants: 3, debris: 2 } });
  await assert.rejects(w.service.install([]), /убрать|take off/i);
  const rec = await w.service.install(['plants']);
  assert.equal(rec.categoryId, 'optimization');
  assert.equal([...w.pak(rec).paths()].length, 3);
  const again = await w.service.install(['plants', 'debris']);
  assert.equal(again.id, rec.id);
  assert.equal([...w.pak(again).paths()].length, 5);
  assert.equal(w.library.list().length, 1);
  assert.deepEqual((await w.service.state()).installed, { id: rec.id, groups: ['plants', 'debris'], enabled: true });
});

test('a whole-map terrain in the language folder is the map read', async (t) => {
  const w = world(t);
  const own = path.join(w.installer.langFolder(), 'maps');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'dota.vpk'), buildVpk([entryAt('maps/dota.vmap_c', names('materials/overlays/blood001.vmat'))]));
  assert.deepEqual((await w.service.state()).counts, { plants: 0, debris: 1 });
});

test('after an update the record is built again, and says so', async (t) => {
  const w = world(t);
  const rec = await w.service.install(['debris']);
  assert.deepEqual(w.service.rebuild(['other']), []);
  assert.deepEqual(w.service.rebuild([rec.id]), []);
  for (let i = 0; i < 50 && !w.rebuilt.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(w.rebuilt, [rec.id]);
  assert.equal(w.library.list().length, 1);
});

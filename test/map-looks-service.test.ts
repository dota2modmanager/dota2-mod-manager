/* Towers and trees from the game's own looks, built in the app (src/map-looks-service.ts): what the
 * window is offered, the record each kind builds into My mods, building it again in its place, and
 * after a Dota update. On a game folder made here, with a pak01 holding the files the builds read. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, listVpkPathsFile } from '../src/vpk.ts';
import { createMapLooks, OFFERED_TREES } from '../src/map-looks-service.ts';
import { TREE_SETS } from '../src/tree-sets.ts';

const mod = (asset: string, modifier: string) =>
  `\t\t\t\t"asset_modifier"\n\t\t\t\t{\n\t\t\t\t\t"type"\t\t"entity_model"\n\t\t\t\t\t"asset"\t\t"${asset}"\n\t\t\t\t\t"modifier"\t\t"${modifier}"\n\t\t\t\t}\n`;
const item = (id: string, name: string, mods: string) =>
  `\t\t"${id}"\n\t\t{\n\t\t\t"name"\t\t"${name}"\n\t\t\t"prefab"\t\t"misc"\n\t\t\t"visuals"\n\t\t\t{\n${mods}\t\t\t}\n\t\t}\n`;
const TABLE = `"items_game"\n{\n\t"items"\n\t{\n${
  item('17538', 'New Bloom Building Effects',
    mod('npc_dota_goodguys_tower1_top', 'models/props_structures/tower_dragon_white.vmdl')
    + mod('npc_dota_badguys_tower1_top', 'models/props_structures/tower_dragon_black.vmdl'))
}${item('12937', 'Guardians of the Lost Path Dire Towers', mod('npc_dota_badguys_tower2_mid', 'models/props_structures/rock_golem/tower_dire_rock_golem.vmdl'))
}\t}\n}\n`;

function world(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-map-looks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt('scripts/items/items_game.txt', Buffer.from(TABLE)),
    entryAt('models/props_structures/tower_dragon_white.vmdl_c', Buffer.from('white')),
    entryAt('models/props_structures/tower_dragon_black.vmdl_c', Buffer.from('black')),
    entryAt('models/props_structures/rock_golem/tower_dire_rock_golem.vmdl_c', Buffer.from('golem')),
    entryAt('models/props_tree/tree_oak_spring_01b.vmdl_c', Buffer.from('spring b')),
    entryAt('models/props_tree/tree_oak_spring_01.vmdl_c', Buffer.from('spring')),
  ]));
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  const service = createMapLooks({ gamePath: () => game, installer, library });
  const paths = (rec: { files: { relPath: string }[]; enabled?: boolean }) =>
    listVpkPathsFile(path.join(lang, rec.files[0].relPath + (rec.enabled === false ? '.off' : ''))).sort();
  return { lang, installer, library, service, paths };
}

test("the window is offered the table's tower looks with their sides, and the tree sets that hold up on the default map", (t) => {
  const s = world(t).service.state();
  assert.deepEqual(s.towers, [
    { id: '17538', name: 'New Bloom Building Effects', sides: ['radiant', 'dire'], models: { radiant: 'models/props_structures/tower_dragon_white.vmdl', dire: 'models/props_structures/tower_dragon_black.vmdl' } },
    { id: '12937', name: 'Guardians of the Lost Path Dire Towers', sides: ['dire'], models: { dire: 'models/props_structures/rock_golem/tower_dire_rock_golem.vmdl' } },
  ]);
  assert.deepEqual(s.trees, OFFERED_TREES);
  assert.ok(!s.trees.some((o) => TREE_SETS.find((x) => x.id === o.id)?.tinted), 'no set the map has to tint');
  assert.ok(s.trees.some((o) => o.id === 'winter'));
  assert.deepEqual(s.installed, { towers: null, trees: null });
  // the picture of "As in the game" is the model each side stands in
  assert.deepEqual(s.own.towers, { radiant: 'models/props_structures/radiant_tower002.vmdl', dire: 'models/props_structures/dire_tower002.vmdl' });
  assert.equal(s.trees.find((o) => o.id === 'winter')?.models.radiant, 'models/props_tree/tree_pine_01_heavysnow.vmdl');
});

test('each kind is one record in My mods, built again in its place when chosen again', (t) => {
  const w = world(t);
  const towers = w.service.install('towers', '17538', '12937');
  assert.equal(towers.categoryId, 'towers');
  assert.match(towers.name, /Radiant New Bloom, Dire Guardians of the Lost Path$/);
  assert.deepEqual(towers.generated, { map: 'towers', radiant: '17538', dire: '12937' });
  assert.deepEqual(w.paths(towers), ['models/props_structures/dire_tower002.vmdl_c', 'models/props_structures/radiant_tower002.vmdl_c']);

  const trees = w.service.install('trees', null, 'spring');
  assert.equal(trees.categoryId, 'trees');
  assert.equal(w.paths(trees).length, 4, "Dire's four tree models, Radiant's left alone");

  const again = w.service.install('towers', null, '17538');
  assert.equal(again.id, towers.id);
  assert.deepEqual(w.paths(again), ['models/props_structures/dire_tower002.vmdl_c']);
  assert.equal(w.library.list().length, 2);
  assert.equal(fs.readdirSync(w.lang).filter((f) => /_dir\.vpk$/.test(f)).length, 2, 'the old pak went');
  assert.deepEqual(w.service.state().installed.towers, { id: towers.id, radiant: null, dire: '17538', enabled: true });
});

test("a look the game has not got for that side, a set the map would tint, or nothing at all is refused", (t) => {
  const { service } = world(t);
  assert.throws(() => service.install('towers', '12937', null), /такого вида|no such look/i, 'a Dire-only look on Radiant');
  assert.throws(() => service.install('trees', 'coloseum', null), /такого вида|no such look/i);
  assert.throws(() => service.install('trees', null, null), /сторон|side/i);
  assert.throws(() => service.install('roshan', 'a', null), /такого вида|no such look/i);
});

test('after a Dota update the map records it reached are built again, and one that was off stays off', (t) => {
  const w = world(t);
  const rec = w.service.install('towers', '17538', null);
  w.installer.setEnabled(rec.files, false, rec.id);
  w.library.update(rec.id, { enabled: false });
  assert.deepEqual(w.service.rebuild([rec.id, 'someone-else']), [rec.id]);
  const after = w.library.list().find((r) => r.id === rec.id)!;
  assert.equal(after.enabled, false);
  assert.deepEqual(w.paths(after), ['models/props_structures/radiant_tower002.vmdl_c']);
});

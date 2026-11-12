/* Tower looks as a file mod (src/tower-looks.ts), on a table shaped like the game's items_game: an
 * event item that dresses both sides, an item for one side, and the pak built out of a small pak01. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTowerLook, towerLookIds, towerLooks, towerPlan } from '../src/tower-looks.ts';
import { itemVisuals } from '../src/item-visuals.ts';
import { buildVpk, entryAt, listVpkPaths } from '../src/vpk.ts';

const mod = (type: string, asset: string, modifier: string) =>
  `\t\t\t\t"asset_modifier"\n\t\t\t\t{\n\t\t\t\t\t"type"\t\t"${type}"\n\t\t\t\t\t"asset"\t\t"${asset}"\n\t\t\t\t\t"modifier"\t\t"${modifier}"\n\t\t\t\t}\n`;
const item = (id: string, name: string, mods: string) =>
  `\t\t"${id}"\n\t\t{\n\t\t\t"name"\t\t"${name}"\n\t\t\t"prefab"\t\t"misc"\n\t\t\t"visuals"\n\t\t\t{\n${mods}\t\t\t}\n\t\t}\n`;

const TABLE = `"items_game"\n{\n\t"items"\n\t{\n${
  item('100', 'Hat', mod('model', 'models/heroes/x/hat.vmdl', 'models/heroes/x/hat2.vmdl'))
}${item('17538', 'New Bloom Building Effects',
  mod('entity_model', 'npc_dota_goodguys_tower1_top', 'models/props_structures/tower_dragon_white.vmdl')
  + mod('entity_model', 'npc_dota_badguys_tower1_top', 'models/props_structures/tower_dragon_black.vmdl')
  + mod('model', 'models/props_structures/default/radiant_tower002_dest_lvl1.vmdl', 'models/props_structures/tower_dragon_wght_dest_lvl1.vmdl')
  + mod('particle', 'particles/dire_fx/dire_tower002_destruction.vpcf', 'particles/themed_fx/tower_drgn_blk_dest.vpcf')
  + mod('particle_create', '', 'particles/world_tower/dire_tower_orb.vpcf')
  + mod('particle_create', '', 'particles/world_tower/radiant_tower_orb.vpcf'),
)}${item('12937', 'Guardians of the Lost Path Dire Towers',
  mod('entity_model', 'npc_dota_badguys_tower2_mid', 'models/props_structures/rock_golem/tower_dire_rock_golem.vmdl'),
)}\t}\n}\n`;

test('the items that put a model on a tower, each once, with the sides they dress', () => {
  assert.deepEqual(towerLookIds(TABLE), ['17538', '12937']);
  assert.deepEqual(towerLooks(TABLE), [
    { id: '17538', name: 'New Bloom Building Effects', sides: ['radiant', 'dire'], models: { radiant: 'models/props_structures/tower_dragon_white.vmdl', dire: 'models/props_structures/tower_dragon_black.vmdl' } },
    { id: '12937', name: 'Guardians of the Lost Path Dire Towers', sides: ['dire'], models: { dire: 'models/props_structures/rock_golem/tower_dire_rock_golem.vmdl' } },
  ]);
});

test('a side gets its files under the default names and is told what a file cannot carry', () => {
  const v = itemVisuals(TABLE, '17538')!;
  assert.deepEqual(towerPlan(v.modifiers, 'radiant'), {
    files: [
      { at: 'models/props_structures/radiant_tower002.vmdl_c', from: 'models/props_structures/tower_dragon_white.vmdl_c' },
      { at: 'models/props_structures/default/radiant_tower002_dest_lvl1.vmdl_c', from: 'models/props_structures/tower_dragon_wght_dest_lvl1.vmdl_c' },
    ],
    skipped: ['particle_create particles/world_tower/radiant_tower_orb.vpcf'],
  });
  assert.deepEqual(towerPlan(v.modifiers, 'dire').files.map((f) => f.at), [
    'models/props_structures/dire_tower002.vmdl_c',
    'particles/dire_fx/dire_tower002_destruction.vpcf_c',
  ]);
});

test('the pak holds the game\'s files under the tower\'s names, and says what the game lacks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-towers-'));
  try {
    const pak01 = path.join(dir, 'pak01_dir.vpk');
    fs.writeFileSync(pak01, buildVpk([
      entryAt('models/props_structures/tower_dragon_white.vmdl_c', Buffer.from('white')),
      entryAt('models/props_structures/tower_dragon_black.vmdl_c', Buffer.from('black')),
      entryAt('particles/themed_fx/tower_drgn_blk_dest.vpcf_c', Buffer.from('dest')),
    ]));
    const r = buildTowerLook({ pak01, text: TABLE, id: '17538', sides: ['radiant', 'dire'] });
    assert.equal(r.name, 'New Bloom Building Effects');
    assert.equal(r.files, 3);
    assert.deepEqual(r.missing, ['models/props_structures/tower_dragon_wght_dest_lvl1.vmdl_c']);
    assert.equal(r.skipped.length, 2);
    const paths = [...listVpkPaths(r.vpk)].sort();
    assert.deepEqual(paths, [
      'models/props_structures/dire_tower002.vmdl_c',
      'models/props_structures/radiant_tower002.vmdl_c',
      'particles/dire_fx/dire_tower002_destruction.vpcf_c',
    ]);
    assert.throws(() => buildTowerLook({ pak01, text: TABLE, id: '12937', sides: ['radiant'] }), /has no radiant tower/);
    assert.throws(() => buildTowerLook({ pak01, text: TABLE, id: '999', sides: ['dire'] }), /no item 999/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* Stoneclaw Scavengers, cut down: the crab plays its towers' own activities, each an aim matrix that
 * turns it by a pose parameter the plain tower never sets. As the plain tower it stood turned away,
 * moving only its claws (Discord). */
test("a look's tower plays the plain tower's activities facing forward, numbered as the plain one", async () => {
  const { asTower } = await import('../src/tower-looks.ts');
  const { readKv3, numberOf } = await import('../src/kv3.ts');
  const { resourceBlock } = await import('../src/resource.ts');
  const { encodeKv3, resource } = await import('./helpers/kv3-build.ts');
  type S = { name: string; act?: string; refs: number[] };
  const model = (names: string[], seqs: S[]) => resource([
    ['ASEQ', encodeKv3({ obj: [
      ['m_localSequenceNameArray', { arr: names.map((n) => ({ str: n })) }],
      ['m_localS1SeqDescArray', { objs: seqs.map((s) => [
        ['m_sName', { str: s.name }],
        ['m_fetch', { obj: [['m_localReferenceArray', { i32s: s.refs }]] }],
        ['m_autoLayerArray', { objs: [] }],
        ['m_activityArray', { objs: s.act ? [[['m_name', { str: s.act }], ['m_nWeight', { int: 1 }]]] : [] }],
      ]) }],
      ['m_localMultiSeqDescArray', { objs: [] }],
    ] })],
    ['DATA', encodeKv3({ obj: [['m_name', { str: 'a tower' }]] })],
  ]);
  const plain = model(['tower_attack', 'tower_idle'], [
    { name: 'tower_attack', act: 'ACT_DOTA_ATTACK', refs: [0] },
    { name: 'tower_idle', act: 'ACT_DOTA_IDLE', refs: [1] },
  ]);
  const crab = model(['bind_pose', 'idle_multi_aim', '@idle_left', '@idle_neutral', '@idle_right', 'attack_multi_aim', '@attack_left', '@attack_neutral', '@attack_right'], [
    { name: 'bind_pose', refs: [] },
    { name: 'idle_multi_aim', act: 'ACT_DOTA_CUSTOM_TOWER_IDLE', refs: [2, 3, 4] },
    { name: '@idle_left', refs: [2] }, { name: '@idle_neutral', refs: [3] }, { name: '@idle_right', refs: [4] },
    { name: 'attack_multi_aim', act: 'ACT_DOTA_CUSTOM_TOWER_ATTACK', refs: [6, 7, 8] },
    { name: '@attack_left', refs: [6] }, { name: '@attack_neutral', refs: [7] }, { name: '@attack_right', refs: [8] },
  ]);
  const kv = readKv3(resourceBlock(asTower(crab, plain), 'ASEQ').data);
  const get = (n: unknown, k: string) => ((n as { kind: string; members?: Map<string, unknown> }).members?.get(k)) as never;
  const names = (get(kv.root, 'm_localSequenceNameArray') as { items: { value: string }[] }).items.map((x) => x.value);
  const descs = (get(kv.root, 'm_localS1SeqDescArray') as { items: unknown[] }).items;
  const at = (i: number) => {
    const d = descs.find((x) => (get(x, 'm_sName') as { value: string }).value === names[i]);
    const act = (get(d, 'm_activityArray') as { items: unknown[] }).items.map((a) => (get(a, 'm_name') as { value: string }).value);
    const refs = (get(get(d, 'm_fetch'), 'm_localReferenceArray') as { items: never[] }).items.map((r) => names[numberOf(kv, r)]);
    return `${names[i]} ${act.join('+')} <${refs.join(',')}>`;
  };
  assert.deepEqual([at(0), at(1)], ['@attack_neutral ACT_DOTA_ATTACK <@attack_neutral>', '@idle_neutral ACT_DOTA_IDLE <@idle_neutral>'],
    'the numbers the server sends for attack and idle play the crab facing forward');
  assert.equal(asTower(plain, plain), plain, 'a tower that is the plain one already comes back as it was');
});

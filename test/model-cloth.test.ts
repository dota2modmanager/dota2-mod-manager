/* A wearable copied under Centaur's stock paths without its cloth (src/model-cloth.ts): his Rout of
 * the Emerald Marauder axe, banner and tail trailed along the ground behind him while he walked, and
 * his body's own cloth is the one of 129 heroes' with a local force other than 1. On every other
 * hero the cloth keeps swinging: Earth Spirit's Jade Reckoning lost its beads' physics to the fix
 * for Centaur's. The copy keeps every other block and member as it was; the hero's other form keeps
 * its cloth. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { encodeKv3, resource, type V } from './helpers/kv3-build.ts';
import { readKv3 } from '../src/kv3.ts';
import { resourceBlock, resourceBlocks } from '../src/resource.ts';
import { clothDragger, dragsCloth, hasCloth, withoutCloth } from '../src/model-cloth.ts';
import { buildVpk, entryAt, entryPath } from '../src/vpk.ts';
import { gameAssetEntries } from '../src/item-builder-assets.ts';

/** A model as the game compiles one with cloth: its meshes, a PHYS block with a cloth model in it, its DATA. */
function model(cloth: boolean, localForce = 1): Buffer {
  const fe: V = { obj: [['m_CtrlName', { arr: [{ str: 'LWeapon_1' }, { str: 'tassel_0' }] }], ['m_flLocalForce', { dbl: localForce }]] };
  const phys = encodeKv3({ obj: [
    ['m_nFlags', { int: 0 }],
    ['m_boneNames', { arr: [] }],
    ['m_pFeModel', cloth ? fe : { int: 0 }],
    ['m_embeddedKeyvalues', { str: '' }],
  ] });
  return resource([['MDAT', Buffer.from('mesh bytes')], ['PHYS', phys], ['DATA', encodeKv3({ obj: [['m_name', { str: 'weapon' }]] })]]);
}

/** Centaur's body, whose cloth has a local force of 1.5, and Earth Spirit's, which has 1. */
const CENTAUR = model(true, 1.5);
const EARTH_SPIRIT = model(true, 1);

test('a model with cloth loses it, and keeps every other block and member as it was', () => {
  const before = model(true);
  assert.equal(hasCloth(before), true);
  const after = withoutCloth(before);
  assert.equal(hasCloth(after), false);
  const root = readKv3(resourceBlock(after, 'PHYS').data).root;
  assert.ok(root.kind === 'object');
  assert.deepEqual(root.members.get('m_pFeModel'), { kind: 'other', type: 1 }, 'null, as the game writes a model with no cloth');
  assert.deepEqual([...root.members.keys()], ['m_nFlags', 'm_boneNames', 'm_pFeModel', 'm_embeddedKeyvalues']);
  assert.deepEqual(resourceBlocks(after).map((b) => b.name), ['MDAT', 'PHYS', 'DATA']);
  for (const name of ['MDAT', 'DATA']) assert.ok(resourceBlock(after, name).data.equals(resourceBlock(before, name).data), `${name} untouched`);
});

test('a model with no cloth, or none this can read, goes in as it is', () => {
  const plain = resource([['MDAT', Buffer.from('mesh')], ['DATA', encodeKv3({ obj: [['m_name', { str: 'axe' }]] })]]);
  assert.equal(withoutCloth(plain), plain);
  assert.equal(hasCloth(plain), false);
  const broken = Buffer.from('not a resource');
  assert.equal(withoutCloth(broken), broken);
});

test("only a body whose cloth has a local force other than 1 drags its wearables' cloth", () => {
  assert.equal(dragsCloth(CENTAUR), true);
  assert.equal(dragsCloth(EARTH_SPIRIT), false);
  assert.equal(dragsCloth(model(false)), false, 'a body with no cloth');
  assert.equal(dragsCloth(null), false, 'a body not found');
  assert.equal(dragsCloth(Buffer.from('not a resource')), false);
  const drags = clothDragger((p) => (p === 'models/heroes/centaur/centaur.vmdl_c' ? CENTAUR : null));
  assert.equal(drags('models/heroes/centaur/weapon.vmdl_c'), true);
  assert.equal(drags('models/heroes/drow/drow_bow.vmdl_c'), false, 'a folder whose body has another name');
  assert.equal(drags('models/items/centaur/weapon.vmdl_c'), false, 'not a stock path');
});

test("the item builder's copy goes without cloth under Centaur's stock paths only, the hero's other form keeps its own", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-cloth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt('models/heroes/centaur/centaur.vmdl_c', CENTAUR),
    entryAt('models/heroes/earth_spirit/earth_spirit.vmdl_c', EARTH_SPIRIT),
    entryAt('models/items/centaur/corrupted_contender_weapon/corrupted_contender_weapon.vmdl_c', model(true)),
    entryAt('models/items/centaur/corrupted_contender_tail/corrupted_contender_tail.vmdl_c', model(true)),
    entryAt('models/items/terrorblade/dreadhunt_demon/dreadhunt_demon.vmdl_c', model(true)),
    entryAt('models/items/earth_spirit/jade_reckoning_v2/mesh/jade_reckoning_v2.vmdl_c', model(true)),
  ]));
  const entries = gameAssetEntries(dir, [
    { from: 'models/items/centaur/corrupted_contender_weapon/corrupted_contender_weapon.vmdl', to: 'models/heroes/centaur/weapon.vmdl' },
    { from: 'models/items/centaur/corrupted_contender_tail/corrupted_contender_tail.vmdl', to: 'models/heroes/centaur/tail.vmdl' },
    { from: 'models/items/terrorblade/dreadhunt_demon/dreadhunt_demon.vmdl', to: 'models/heroes/terrorblade/demon.vmdl', form: true },
    { from: 'models/items/earth_spirit/jade_reckoning_v2/mesh/jade_reckoning_v2.vmdl', to: 'models/heroes/earth_spirit/earth_spirit_staff.vmdl' },
  ]);
  const by = Object.fromEntries(entries.map((e) => [entryPath(e), e.data]));
  assert.equal(hasCloth(by['models/heroes/centaur/weapon.vmdl_c']), false, "Centaur's axe");
  assert.equal(hasCloth(by['models/heroes/centaur/tail.vmdl_c']), false, "Centaur's tail");
  assert.equal(hasCloth(by['models/heroes/terrorblade/demon.vmdl_c']), true, "the hero's other form is a body, cloth and all");
  assert.equal(hasCloth(by['models/heroes/earth_spirit/earth_spirit_staff.vmdl_c']), true, "Earth Spirit's staff keeps its beads swinging");
});

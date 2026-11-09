/* A wearable copied under a stock item's path without its cloth (src/model-cloth.ts): Centaur's
 * Rout of the Emerald Marauder axe and banner trailed along the ground behind him while he walked.
 * The copy keeps every other block and member as it was; the hero's other form keeps its cloth. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { encodeKv3, resource } from './helpers/kv3-build.ts';
import { readKv3 } from '../src/kv3.ts';
import { resourceBlock, resourceBlocks } from '../src/resource.ts';
import { hasCloth, withoutCloth } from '../src/model-cloth.ts';
import { buildVpk, entryAt, entryPath } from '../src/vpk.ts';
import { gameAssetEntries } from '../src/item-builder-assets.ts';

/** A model as the game compiles a wearable with tassels: its meshes, a PHYS block with a cloth model in it, its DATA. */
function wearable(cloth: boolean): Buffer {
  const phys = encodeKv3({ obj: [
    ['m_nFlags', { int: 0 }],
    ['m_boneNames', { arr: [] }],
    ['m_pFeModel', cloth ? { obj: [['m_CtrlName', { arr: [{ str: 'LWeapon_1' }, { str: 'tassel_0' }] }], ['m_flLocalForce', { dbl: 1 }]] } : { int: 0 }],
    ['m_embeddedKeyvalues', { str: '' }],
  ] });
  return resource([['MDAT', Buffer.from('mesh bytes')], ['PHYS', phys], ['DATA', encodeKv3({ obj: [['m_name', { str: 'weapon' }]] })]]);
}

test('a model with cloth loses it, and keeps every other block and member as it was', () => {
  const before = wearable(true);
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

test("the item builder's copy under a stock path goes without cloth, the hero's other form keeps its own", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-cloth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt('models/items/centaur/corrupted_contender_weapon/corrupted_contender_weapon.vmdl_c', wearable(true)),
    entryAt('models/items/terrorblade/dreadhunt_demon/dreadhunt_demon.vmdl_c', wearable(true)),
  ]));
  const entries = gameAssetEntries(dir, [
    { from: 'models/items/centaur/corrupted_contender_weapon/corrupted_contender_weapon.vmdl', to: 'models/heroes/centaur/weapon.vmdl' },
    { from: 'models/items/terrorblade/dreadhunt_demon/dreadhunt_demon.vmdl', to: 'models/heroes/terrorblade/demon.vmdl', form: true },
  ]);
  const by = Object.fromEntries(entries.map((e) => [entryPath(e), e.data]));
  assert.equal(hasCloth(by['models/heroes/centaur/weapon.vmdl_c']), false, 'the wearable under the stock path');
  assert.equal(hasCloth(by['models/heroes/terrorblade/demon.vmdl_c']), true, "the hero's other form is a body, cloth and all");
});

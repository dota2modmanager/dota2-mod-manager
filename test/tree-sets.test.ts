/* Trees from another of the game's sets, per side (src/tree-sets.ts): which file goes under which
 * name, and the pak built out of a small pak01. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTrees, DEFAULT_TREES, TREE_SETS, treePlan } from '../src/tree-sets.ts';
import { buildVpk, entryAt, listVpkPaths } from '../src/vpk.ts';

const set = (id: string) => TREE_SETS.find((s) => s.id === id)!;

test('each default model of a side takes the set\'s models in turn, and a side\'s own set changes nothing', () => {
  const plan = treePlan('dire', set('autumn'));
  assert.deepEqual(plan.map((f) => f.from), [
    'models/props_tree/tree_oak_autumn_01b.vmdl_c', 'models/props_tree/cornstack/cornstack.vmdl_c',
    'models/props_tree/tree_oak_autumn_01b.vmdl_c', 'models/props_tree/cornstack/cornstack.vmdl_c',
  ]);
  assert.deepEqual(plan.map((f) => f.at), DEFAULT_TREES.dire.map((m) => `${m}_c`));
  assert.deepEqual(treePlan('radiant', set('radiant')), []);
  assert.equal(treePlan('radiant', set('dire')).length, DEFAULT_TREES.radiant.length);
});

test('the pak holds the set\'s files under the side\'s names, and says what the game lacks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-trees-'));
  try {
    const pak01 = path.join(dir, 'pak01_dir.vpk');
    fs.writeFileSync(pak01, buildVpk([
      entryAt('models/props_tree/tree_oak_spring_01b.vmdl_c', Buffer.from('a')),
      entryAt('models/props_tree/tree_oak_spring_01.vmdl_c', Buffer.from('b')),
    ]));
    const r = buildTrees({ pak01, dire: 'spring' });
    assert.equal(r.files, 4);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(listVpkPaths(r.vpk).sort(), DEFAULT_TREES.dire.map((m) => `${m}_c`).sort());
    const both = buildTrees({ pak01, radiant: 'winter', dire: 'spring' });
    assert.equal(both.files, 4);
    assert.equal(both.missing.length, DEFAULT_TREES.radiant.length);
    assert.throws(() => buildTrees({ pak01, radiant: 'moon' }), /no set "moon"/);
    assert.throws(() => buildTrees({ pak01, radiant: 'radiant', dire: null }), /pick a set/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Which of the game's trees a node of the map's 3D view is, by its name (renderer/catalog/decor/map-trees.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { treeModelOf } from '../renderer/catalog/decor/map-trees.ts';

test('a tree node names its model, with or without the dot three takes out', () => {
  assert.equal(treeModelOf('dire_tree004.dire_tree004_model'), 'dire_tree004');
  assert.equal(treeModelOf('dire_tree004dire_tree004_model'), 'dire_tree004');
  assert.equal(treeModelOf('tree_oak_01btree_oak_01b_model'), 'tree_oak_01b');
  assert.equal(treeModelOf('tree_pine_01tree_pine_01_model_3'), 'tree_pine_01');
  assert.equal(treeModelOf('Tree_Pine_01Tree_Pine_01_model'), 'tree_pine_01');
});

test('the merged trees and other nodes name none', () => {
  assert.equal(treeModelOf('n0_lr0_agg_prop_tree_oak_leaves_05_12'), null);
  assert.equal(treeModelOf('dire_tree004tree_dire_04_stump_model'), null);
  assert.equal(treeModelOf('rock_01'), null);
  assert.equal(treeModelOf(''), null);
});

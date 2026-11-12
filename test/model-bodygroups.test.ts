/* Body groups as a model's own default (src/model-bodygroups.ts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenMeshes, withBodygroups, withoutMeshes } from '../src/model-bodygroups.ts';
import { numberOf, readKv3 } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { encodeKv3, resource, rerl, type V } from './helpers/kv3-build.ts';

const model = (groups: string[], mask: number): Buffer => resource([['RERL', rerl([])], ['DATA', encodeKv3({ obj: [
  ['m_meshGroups', { arr: groups.map((str): V => ({ str })) }],
  ['m_nDefaultMeshGroupMask', { i64: mask }],
] })]]);
const maskOf = (b: Buffer) => {
  const kv = readKv3(resourceBlock(b, 'DATA').data);
  const n = kv.root.kind === 'object' ? kv.root.members.get('m_nDefaultMeshGroupMask') : null;
  return numberOf(kv, n as Extract<typeof n, { kind: 'number' }>);
};

test('a group takes the choice asked for, and the others stay as they were', () => {
  const m = model(['head_@0_#&0', 'head_@1_#&1', 'arm_l_@0_#&0', 'arm_l_@1_#&1'], 0b0101);
  assert.equal(maskOf(withBodygroups(m, new Map([['head', 1]])) as Buffer), 0b0110);
  assert.equal(maskOf(withBodygroups(m, new Map([['head', 1], ['arm_l', 1]])) as Buffer), 0b1010);
});

test('a model emptied draws none of its meshes', () => {
  const m = resource([['RERL', rerl([])], ['DATA', encodeKv3({ obj: [
    ['m_nDefaultMeshGroupMask', { i64: -1 }],
    ['m_refMeshGroupMasks', { arr: [{ i64: -1 }] }],
  ] })]]);
  const out = withoutMeshes(m) as Buffer;
  assert.equal(maskOf(out), 0);
  const kv = readKv3(resourceBlock(out, 'DATA').data);
  const refs = kv.root.kind === 'object' ? kv.root.members.get('m_refMeshGroupMasks') : null;
  assert.deepEqual(refs?.kind === 'array' ? refs.items.map((n) => (n.kind === 'number' ? numberOf(kv, n) : null)) : null, [0]);
});

test('what is no model stays out', () => {
  assert.equal(withoutMeshes(model([], 1)), null);
});

test('a model without the group is no change', () => {
  assert.equal(withBodygroups(model(['head_@0_#&0'], 1), new Map([['tail', 1]])), null);
  assert.equal(withBodygroups(model([], 1), new Map([['head', 1]])), null);
});

test('the meshes of a choice turned off are named, for the preview to hide', () => {
  const m = resource([
    ['CTRL', encodeKv3({ obj: [['embedded_meshes', { objs: [[['name', { str: 'Upper' }], ['mesh_index', { int: 2 }]], [['name', { str: 'lower' }], ['mesh_index', { int: 3 }]]] }]] })],
    ['RERL', rerl([])],
    ['DATA', encodeKv3({ obj: [
      ['m_meshGroups', { arr: ['upper_@0_#&0', 'upper_@1_#&1', 'lower_@0_#&0', 'lower_@1_#&1'].map((str): V => ({ str })) }],
      ['m_nDefaultMeshGroupMask', { i64: 0b0101 }],
      ['m_refMeshGroupMasks', { i32s: [0, 0, 0b0001, 0b0100] }],
    ] })],
  ]);
  assert.deepEqual(hiddenMeshes(m, new Map([['upper', 1]])), ['upper']);
  assert.deepEqual(hiddenMeshes(m, new Map([['nothing', 1]])), []);
});

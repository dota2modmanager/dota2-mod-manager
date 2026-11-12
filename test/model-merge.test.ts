/* A second model carried inside the first (src/model-merge.ts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergedModel, withBlocks } from '../src/model-merge.ts';
import { numberOf, readKv3, type Kv3Node } from '../src/kv3.ts';
import { references, resourceBlock, resourceBlocks } from '../src/resource.ts';
import { encodeKv3, resource, rerl, type V } from './helpers/kv3-build.ts';

const strs = (x: string[]): V => ({ arr: x.map((str): V => ({ str })) });
const mesh = (name: string, index: number, data: number, vbib: number, morph = -1): [string, V][] => [
  ['name', { str: name }], ['mesh_index', { int: index }], ['data_block', { int: data }], ['vbib_block', { int: vbib }], ['morph_block', { int: morph }], ['morph_texture', { str: '' }],
];
const skeleton = (names: string[], parents: number[]): V => ({ obj: [['m_boneName', strs(names)], ['m_nParent', { i32s: parents }]] });

function model(opts: { meshes: [string, V][][]; names: string[]; parents: number[]; table: number[]; starts: number[]; refs: string[]; pad: string }): Buffer {
  return resource([
    ['MDAT', Buffer.from(`${opts.pad}-mesh`)], ['MBUF', Buffer.from(`${opts.pad}-buffers`)],
    ['CTRL', encodeKv3({ obj: [['embedded_meshes', { objs: opts.meshes }], ['pool_size_hint_mesh', { int: 100 }]] })],
    ['RERL', rerl(opts.refs)],
    ['DATA', encodeKv3({ obj: [
      ['m_refMeshGroupMasks', { i32s: [5] }], ['m_refLODGroupMasks', { i32s: [255] }],
      ['m_modelSkeleton', skeleton(opts.names, opts.parents)],
      ['m_remappingTable', { i32s: opts.table }], ['m_remappingTableStarts', { i32s: opts.starts }],
      ['m_materialGroups', { objs: [[['m_name', { str: 'default' }], ['m_materials', strs(opts.refs)]]] }],
    ] })],
  ]);
}
const first = () => model({ meshes: [mesh('a', 0, 0, 1)], names: ['Root', 'arm'], parents: [-1, 0], table: [1, 0], starts: [0], refs: ['materials/a.vmat'], pad: 'first' });
const second = (meshes = [mesh('b', 0, 0, 1)]) => model({ meshes, names: ['root', 'skirt', 'tip'], parents: [-1, 0, 1], table: [2, 1, 0], starts: [0], refs: ['materials/b.vmat'], pad: 'second' });

const ints = (kv: ReturnType<typeof readKv3>, n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items.map((x) => (x.kind === 'number' ? numberOf(kv, x) : null)) : []);
const get = (kv: ReturnType<typeof readKv3>, k: string) => (kv.root.kind === 'object' ? kv.root.members.get(k) : undefined);
const texts = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items.map((x) => (x.kind === 'string' ? x.value : '')) : []);

test('a block added lies on a 16-byte line, and the file reads as before', () => {
  const out = withBlocks(first(), [{ name: 'MDAT', data: Buffer.from('x') }, { name: 'MBUF', data: Buffer.from('yz') }]);
  const blocks = resourceBlocks(out);
  assert.deepEqual(blocks.slice(0, 5).map((b) => b.name), resourceBlocks(first()).map((b) => b.name));
  assert.equal(out.toString('ascii', blocks[0].at, blocks[0].at + blocks[0].size), 'first-mesh');
  assert.equal(out.toString('ascii', blocks[5].at, blocks[5].at + 1), 'x');
  assert.equal(out.toString('ascii', blocks[6].at, blocks[6].at + 2), 'yz');
  assert.equal(blocks[5].at % 16, 0);
  assert.equal(out.readUInt32LE(0), out.length);
});

test('the second model comes in as a mesh of the first, on a skeleton of both', () => {
  const out = mergedModel(first(), second()) as Buffer;
  const blocks = resourceBlocks(out);
  const ctrl = readKv3(resourceBlock(out, 'CTRL').data);
  const data = readKv3(resourceBlock(out, 'DATA').data);
  const meshes = get(ctrl, 'embedded_meshes');
  assert.ok(meshes?.kind === 'array' && meshes.items.length === 2);
  const m = meshes.items[1];
  const field = (k: string) => { const n = m.kind === 'object' ? m.members.get(k) : null; return numberOf(ctrl, n as never); };
  assert.equal(field('mesh_index'), 1);
  assert.equal(blocks[field('data_block') as number].name, 'MDAT');
  assert.equal(out.toString('ascii', blocks[field('vbib_block') as number].at, blocks[field('vbib_block') as number].at + 14), 'second-buffers');
  assert.deepEqual(ints(ctrl, get(ctrl, 'embedded_meshes')).length, 2);
  const skel = get(data, 'm_modelSkeleton');
  const bones = skel?.kind === 'object' ? skel.members : new Map();
  assert.deepEqual(texts(bones.get('m_boneName')), ['Root', 'arm', 'skirt', 'tip'], 'a bone of the same name in another case is the same bone');
  assert.deepEqual(ints(data, bones.get('m_nParent')), [-1, 0, 0, 2]);
  assert.deepEqual(ints(data, get(data, 'm_remappingTable')), [1, 0, 3, 2, 0]);
  assert.deepEqual(ints(data, get(data, 'm_remappingTableStarts')), [0, 2]);
  assert.deepEqual(ints(data, get(data, 'm_refMeshGroupMasks')), [5, 5]);
  assert.deepEqual(ints(data, get(data, 'm_refLODGroupMasks')), [255, 255]);
  assert.deepEqual(references(out), ['materials/a.vmat', 'materials/b.vmat']);
});

test('a second model with morphs stays out', () => {
  assert.equal(mergedModel(first(), second([mesh('b', 0, 0, 1, 2)])), null);
});

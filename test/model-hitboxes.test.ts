/* Hitboxes over a wearable's surface (src/model-hitboxes.ts), on a model built by hand, as the game
 * lays one out: an MBUF block of positions with one bone index, and its mesh's skeleton. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshoptEncoder } from 'meshoptimizer';

import { fitBoxes, nameHash, surfaceBoxes, withSurfaceHitboxes } from '../src/model-hitboxes.ts';
import { modelScaleReady } from '../src/model-scale.ts';
import { readKv3, numberOf, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { at, encodeKv3, resource, type V } from './helpers/kv3-build.ts';

await modelScaleReady();

const SIZE = 16; // a float3 position, then four blend indices
function vertices(points: number[][], bone = 0): Buffer {
  const b = Buffer.alloc(points.length * SIZE);
  points.forEach((p, v) => { p.forEach((x, c) => b.writeFloatLE(x, v * SIZE + 4 * c)); b[v * SIZE + 12] = bone; });
  return b;
}

function mbuf(data: Buffer, count: number): Buffer {
  const attrs = Buffer.alloc(112);
  attrs.write('POSITION', 0, 'latin1');
  attrs.writeUInt32LE(6, 36);
  attrs.write('BLENDINDICES', 56, 'latin1');
  attrs.writeUInt32LE(30, 56 + 36);
  attrs.writeUInt32LE(12, 56 + 40);
  const head = Buffer.alloc(16 + 24 + 24);
  head.writeUInt32LE(16, 0); head.writeUInt32LE(1, 4);
  head.writeUInt32LE(40 - 8, 8); head.writeUInt32LE(0, 12);
  head.writeUInt32LE(count, 16); head.writeUInt32LE(SIZE, 20);
  head.writeUInt32LE(head.length - 24, 24); head.writeUInt32LE(2, 28);
  head.writeUInt32LE(head.length + attrs.length - 32, 32); head.writeUInt32LE(data.length, 36);
  return Buffer.concat([head, attrs, data]);
}

const f64s = (n: number[]): V => ({ f64s: n });
const MOVED_UP = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -100]; // the bone stands 100 up: in its space a vertex is 100 lower
const mdat = encodeKv3({ obj: [
  ['m_skeleton', { obj: [['m_bones', { objs: [[['m_boneName', { str: 'axe_1' }], ['m_invBindPose', f64s(MOVED_UP)]]] }]] }],
  ['m_hitboxsets', { arr: [] }],
] });

function model(points: number[][], compress = false): Buffer {
  const raw = vertices(points);
  const data = compress ? Buffer.from(MeshoptEncoder.encodeVertexBufferLevel(raw, points.length, SIZE, 2, 0)) : raw;
  const ctrl = encodeKv3({ obj: [['embedded_meshes', { objs: [[['data_block', { int: 0 }], ['vbib_block', { int: 1 }], ['mesh_index', { int: 0 }]]] }]] });
  const info = encodeKv3({ obj: [
    ['m_modelSkeleton', { obj: [['m_boneName', { arr: [{ str: 'axe_1' }] }], ['m_nFlag', { arr: [{ int: 0xcc0 }] }]] }],
    ['m_remappingTable', { arr: [{ int: 0 }] }],
    ['m_remappingTableStarts', { arr: [{ int: 0 }] }],
  ] });
  return resource([['MDAT', mdat], ['MBUF', mbuf(data, points.length)], ['CTRL', ctrl], ['DATA', info]]);
}

const blade = Array.from({ length: 200 }, (_, i) => [i, i % 7, 100 + (i % 3)]);

test('names hash as the game hashes them', () => {
  assert.equal(nameHash('default'), 1977497166);
  assert.equal(nameHash('elbow_L'), 539281912);
});

test('boxes sit in the bone\'s space and cover every vertex', () => {
  for (const compress of [false, true]) {
    const boxes = surfaceBoxes(model(blade, compress));
    assert.ok(boxes.length > 4 && boxes.length <= 256, `${boxes.length} boxes`);
    assert.ok(boxes.every((b) => b.bone === 'axe_1'));
    for (const [x, y, z] of blade) {
      const local = [x, y, z - 100];
      assert.ok(boxes.some((b) => local.every((c, i) => c >= b.min[i] && c <= b.max[i])), `${local} is in no box`);
    }
  }
});

test('the set goes on the mesh under every name asked for, and reads back as the game\'s do', () => {
  const out = withSurfaceHitboxes(model(blade), ['default', 'body']);
  assert.ok(out);
  const kv = readKv3(resourceBlock(out, 'MDAT').data);
  const sets = at(kv.root, 'm_hitboxsets') as Extract<Kv3Node, { kind: 'array' }>;
  assert.equal(sets.items.length, 2);
  const value = at(sets.items[0], 'value');
  assert.equal((at(value, 'm_name') as { value: string }).value, 'default');
  assert.equal(numberOf(kv, at(value, 'm_nNameHash') as Extract<Kv3Node, { kind: 'number' }>), 1977497166);
  const box = at(value, 'm_HitBoxes', 0);
  assert.equal((at(box, 'm_sBoneName') as { value: string }).value, 'axe_1');
  assert.equal(numberOf(kv, at(box, 'm_nBoneNameHash') as Extract<Kv3Node, { kind: 'number' }>), nameHash('axe_1'));
});

test('the bone under the boxes is flagged for hitboxes, and its other flags stay', () => {
  const kv = readKv3(resourceBlock(withSurfaceHitboxes(model(blade))!, 'DATA').data);
  assert.equal(numberOf(kv, at(kv.root, 'm_modelSkeleton', 'm_nFlag', 0) as Extract<Kv3Node, { kind: 'number' }>), 0xdc0);
});

test('a set the model has stays, and a model with no vertices is refused', () => {
  const once = withSurfaceHitboxes(model(blade))!;
  const twice = withSurfaceHitboxes(once)!;
  const kv = readKv3(resourceBlock(twice, 'MDAT').data);
  assert.equal((at(kv.root, 'm_hitboxsets') as Extract<Kv3Node, { kind: 'array' }>).items.length, 1);
  assert.equal(withSurfaceHitboxes(model([])), null);
  assert.equal(withSurfaceHitboxes(Buffer.from('not a model')), null);
});

test('a model of many bones gets a box per bone at once, and one of more bones than boxes does not hang', () => {
  // 120 bones, each with a vertex in all eight corners round the origin: 960 cells however big they grow
  const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x * 40, y * 40, z * 40])));
  const many = Array.from({ length: 120 }, (_, b) => corners.map((at) => ({ bone: `b${b}`, at }))).flat();
  const t = Date.now();
  const boxes = fitBoxes(many);
  assert.equal(boxes.length, 120);
  assert.deepEqual(boxes[7], { bone: 'b7', min: [-41.5, -41.5, -41.5], max: [41.5, 41.5, 41.5] });
  // more bones than MAX_BOXES (256): the old loop never ended
  const lots = Array.from({ length: 300 }, (_, b) => ({ bone: `b${b}`, at: [b, 0, 0] }));
  assert.equal(fitBoxes(lots).length, 300);
  assert.ok(Date.now() - t < 2000, 'quickly');
  // a model that fits stays as fine as before
  assert.equal(fitBoxes([{ bone: 'a', at: [0, 0, 0] }, { bone: 'a', at: [100, 0, 0] }]).length, 2);
});

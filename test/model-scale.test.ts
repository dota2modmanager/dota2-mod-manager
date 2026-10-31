/* A persona's items made as big as its body (src/model-scale.ts), on models built by hand in both
 * layouts the game has: an older mesh with its buffers in one MBUF block, a newer one with an MVTX
 * block per buffer and its layout in CTRL; both meshopt-compressed, as most of the personas' are.
 *
 * The promise: every vertex, bone and bound is the factor bigger, nothing else in a vertex moves,
 * the buffers stay in the codec and version the game reads, and a model is measured against another
 * by its bones. Valve's own files cannot be committed here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

import { modelScaleAgainst, modelScaleReady, scaleModel, scaledModels } from '../src/model-scale.ts';
import { readKv3, numberOf, type Kv3Block, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock, resourceBlocks } from '../src/resource.ts';
import { entryAt, entryPath } from '../src/vpk.ts';
import { at, encodeKv3, resource, type V } from './helpers/kv3-build.ts';

await modelScaleReady();

const SIZE = 16; // a float3 position, then four bytes that are not one
const POSITIONS = [[1, 2, 3], [-4, 5.5, 60], [7, -8, 0.25]];
function vertices(points = POSITIONS): Buffer {
  const b = Buffer.alloc(points.length * SIZE);
  points.forEach((p, v) => { p.forEach((x, c) => b.writeFloatLE(x, v * SIZE + 4 * c)); b.writeUInt32LE(0xabcd0000 + v, v * SIZE + 12); });
  return b;
}
const packed = (raw: Buffer) => Buffer.from(MeshoptEncoder.encodeVertexBufferLevel(raw, raw.length / SIZE, SIZE, 2, 0));
const unpacked = (data: Buffer, count = POSITIONS.length) => {
  const out = new Uint8Array(count * SIZE);
  MeshoptDecoder.decodeVertexBuffer(out, count, SIZE, data);
  return Buffer.from(out);
};
const INDICES = Buffer.from([0, 0, 1, 0, 2, 0, 0, 0]);

/** An MBUF block: one vertex buffer and one index buffer, each header's offsets counted from where they are written. */
function mbuf(data: Buffer): Buffer {
  const attrs = Buffer.alloc(56);
  attrs.write('POSITION', 0, 'latin1');
  attrs.writeUInt32LE(6, 36); // R32G32B32_FLOAT
  const head = Buffer.alloc(16 + 24 + 24);
  head.writeUInt32LE(16, 0); head.writeUInt32LE(1, 4); // vertex buffers: header at 16
  head.writeUInt32LE(40 - 8, 8); head.writeUInt32LE(1, 12); // index buffers: header at 40
  const attrsAt = head.length, dataAt = attrsAt + 56, indexAt = dataAt + Math.ceil(data.length / 16) * 16;
  head.writeUInt32LE(POSITIONS.length, 16); head.writeUInt32LE(SIZE, 20);
  head.writeUInt32LE(attrsAt - 24, 24); head.writeUInt32LE(1, 28);
  head.writeUInt32LE(dataAt - 32, 32); head.writeUInt32LE(data.length, 36);
  head.writeUInt32LE(4, 40); head.writeUInt32LE(2, 44);
  head.writeUInt32LE(indexAt - 56, 56); head.writeUInt32LE(INDICES.length, 60);
  return Buffer.concat([head, attrs, data, Buffer.alloc(indexAt - dataAt - data.length), INDICES]);
}
/** The vertex and index data of an MBUF block, read the way the game does. */
function mbufData(block: Buffer) {
  const vb = 16 + 16 + block.readUInt32LE(32), ib = 56 + block.readUInt32LE(56);
  return { vertices: block.subarray(vb, vb + block.readUInt32LE(36)), indices: block.subarray(ib, ib + block.readUInt32LE(60)) };
}

const f64s = (n: number[]): V => ({ f64s: n });
const ROTATION_AND_MOVE = [0, 0, 1, -100, 1, 0, 0, 3.5, 0, 1, 0, 0];
const mdat = encodeKv3({ obj: [
  ['m_sceneObjects', { objs: [[['m_vMinBounds', f64s([-4, -8, 0.25])], ['m_vMaxBounds', f64s([7, 5.5, 60])]]] }],
  ['m_skeleton', { obj: [['m_bones', { objs: [[['m_boneName', { str: 'pelvis' }], ['m_invBindPose', f64s(ROTATION_AND_MOVE)]]] }]] }],
] });
const skeleton = (lengths: number[][]): V => ({ obj: [
  ['m_modelSkeleton', { obj: [
    ['m_boneName', { arr: lengths.map((_, i) => ({ str: `bone${i}` })) }],
    ['m_bonePosParent', { arr: lengths.map(f64s) }],
  ] }],
  ['m_modelInfo', { obj: [['m_vHullMax', f64s([10, 20, 30])]] }],
] });
const BONES = [[0, 0, 100], [3, 4, 0], [0, 0, 0]];

/** A model with an older mesh (blocks 0, 1) and a newer one (2, 3), and CTRL saying which is which. */
function model(): Buffer {
  const ctrl = encodeKv3({ obj: [['embedded_meshes', { objs: [
    [['data_block', { int: 0 }], ['vbib_block', { int: 1 }]],
    [['m_nDataBlock', { int: 2 }], ['m_nVBIBBlock', { int: -1 }], ['m_vertexBuffers', { objs: [[
      ['m_nBlockIndex', { int: 3 }], ['m_nElementCount', { int: POSITIONS.length }], ['m_nElementSizeInBytes', { int: SIZE }],
      ['m_bMeshoptCompressed', { yes: true }],
      ['m_inputLayoutFields', { objs: [[['m_pSemanticName', { str: 'POSITION' }], ['m_Format', { int: 6 }], ['m_nOffset', { int: 0 }]]] }],
    ]] }]],
  ] }]] });
  return resource([['MDAT', mdat], ['MBUF', mbuf(packed(vertices()))], ['MDAT', mdat], ['MVTX', packed(vertices())],
    ['CTRL', ctrl], ['DATA', encodeKv3(skeleton(BONES))]]);
}

const numbers = (kv: Kv3Block, n: Kv3Node) => (n as Extract<Kv3Node, { kind: 'array' }>).items.map((x) => +numberOf(kv, x as Extract<Kv3Node, { kind: 'number' }>).toFixed(4));
const positions = (raw: Buffer) => Array.from({ length: raw.length / SIZE }, (_, v) => [0, 1, 2].map((c) => +raw.readFloatLE(v * SIZE + 4 * c).toFixed(4)));
const times = (s: number) => POSITIONS.map((p) => p.map((x) => +Math.fround(Math.fround(x) * s).toFixed(4)));

test('every vertex of both layouts is the factor bigger, and nothing else in a vertex changes', () => {
  const out = scaleModel(model(), 1.35);
  const older = mbufData(resourceBlock(out, 'MBUF').data);
  const newer = resourceBlock(out, 'MVTX').data;
  for (const data of [older.vertices, newer]) {
    assert.equal(data[0], 0xa0, "still meshopt, in the version the game's own buffers are");
    const raw = unpacked(data);
    assert.deepEqual(positions(raw), times(1.35));
    assert.deepEqual([0, 1, 2].map((v) => raw.readUInt32LE(v * SIZE + 12)), [0xabcd0000, 0xabcd0001, 0xabcd0002], 'what follows a position stays');
  }
  assert.deepEqual(older.indices, INDICES, 'the index buffer is where its header says, as it was');
});

test("the bones, the skinning's bind poses and the bounds are the factor bigger, and the rotations are not", () => {
  const out = scaleModel(model(), 2);
  for (const nth of [0, 1]) {
    const kv = readKv3(resourceBlock(out, 'MDAT', nth).data);
    assert.deepEqual(numbers(kv, at(kv.root, 'm_skeleton', 'm_bones', 0, 'm_invBindPose')), [0, 0, 1, -200, 1, 0, 0, 7, 0, 1, 0, 0]);
    assert.deepEqual(numbers(kv, at(kv.root, 'm_sceneObjects', 0, 'm_vMaxBounds')), [14, 11, 120]);
  }
  const data = readKv3(resourceBlock(out, 'DATA').data);
  assert.deepEqual(numbers(data, at(data.root, 'm_modelSkeleton', 'm_bonePosParent', 1)), [6, 8, 0]);
  assert.deepEqual(numbers(data, at(data.root, 'm_modelInfo', 'm_vHullMax')), [20, 40, 60]);
  assert.deepEqual(resourceBlocks(out).map((b) => b.name), resourceBlocks(model()).map((b) => b.name), 'the same blocks in the same order');
  const same = model();
  assert.equal(scaleModel(same, 1), same, 'the factor 1 leaves the file alone');
});

test('a model is measured against another by the bones they share', () => {
  const body = (s: number) => resource([['DATA', encodeKv3(skeleton(BONES.map((p) => p.map((x) => x * s))))]]);
  assert.equal(+modelScaleAgainst(body(1.351), body(1))!.toFixed(3), 1.351, "a body compiled bigger than Valve's");
  assert.equal(modelScaleAgainst(body(1), body(1)), 1);
  assert.equal(+modelScaleAgainst(scaleModel(model(), 1.5), model())!.toFixed(3), 1.5, 'and a scaled item against its own');
  assert.equal(modelScaleAgainst(body(1), resource([['DATA', encodeKv3(skeleton([[0, 0, 0]]))]])), null, 'no length to measure');
});

test("a pick's models are scaled, its other files are not, and a model that cannot be is kept and named", () => {
  const skipped: string[] = [];
  const entries = [entryAt('models/items/a/head.vmdl_c', model()), entryAt('particles/a/glow.vpcf_c', Buffer.from('glow')),
    entryAt('models/items/a/broken.vmdl_c', Buffer.from('not a model'))];
  const out = scaledModels(entries, 1.35, (p) => skipped.push(p));
  assert.notDeepEqual(out[0].data, entries[0].data);
  assert.equal(out[1], entries[1]);
  assert.equal(out[2], entries[2]);
  assert.deepEqual(skipped, ['models/items/a/broken.vmdl_c']);
  assert.equal(scaledModels(entries, undefined, () => {}), entries, 'no factor: nothing to do');
  assert.deepEqual(out.map(entryPath), entries.map(entryPath));
});

/* An effect copied to spread over a wearable's surface (src/particle-surface.ts), on systems built
 * by hand with the fields that matter. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceSystem } from '../src/particle-surface.ts';
import { SURFACE_SET } from '../src/model-hitboxes.ts';
import { readKv3, type Kv3Node } from '../src/kv3.ts';
import { references, resourceBlock } from '../src/resource.ts';
import { entryPath } from '../src/vpk.ts';
import { at, encodeKv3, resource, rerl, type V } from './helpers/kv3-build.ts';

const op = (name: string, extra: [string, V][] = []): [string, V][] => [['_class', { str: name }], ...extra];
const onModel = op('C_INIT_CreateOnModel', [['m_bUseMesh', { yes: true }]]);

function system(fields: [string, V][]): Buffer {
  return resource([['RERL', rerl([])], ['DATA', encodeKv3({ obj: fields })]]);
}

const files = new Map<string, Buffer>([
  ['particles/a.vpcf_c', system([['m_Initializers', { objs: [] }], ['m_Children', { objs: [[['m_ChildRef', { str: 'particles/b.vpcf' }]]] }]])],
  ['particles/b.vpcf_c', system([['m_Initializers', { objs: [onModel] }], ['m_Operators', { objs: [op('C_OP_Decay'), op('C_OP_SnapshotSkinToBones')] }]])],
  ['particles/attached.vpcf_c', system([['m_Initializers', { objs: [op('C_INIT_CreateFromParentParticles')] }]])],
]);
const read = (p: string) => files.get(p);
const word = (n: Kv3Node) => (n as { value: string }).value;

test('the whole tree is copied, each child under its copy', () => {
  const made = surfaceSystem(read, 'particles/a.vpcf')!;
  assert.equal(made.root, 'particles/mm_surface/a.vpcf');
  assert.deepEqual(made.entries.map(entryPath).sort(), ['particles/mm_surface/a.vpcf_c', 'particles/mm_surface/b.vpcf_c']);
  const root = made.entries.find((e) => entryPath(e).endsWith('a.vpcf_c'))!.data;
  const kv = readKv3(resourceBlock(root, 'DATA').data);
  assert.equal(word(at(kv.root, 'm_Children', 0, 'm_ChildRef')), 'particles/mm_surface/b.vpcf');
  assert.ok(references(root).includes('particles/mm_surface/b.vpcf'), 'the game loads what the file lists');
});

test('an emitter reads the boxes, and a particle is held to its box last', () => {
  const made = surfaceSystem(read, 'particles/a.vpcf')!;
  const kv = readKv3(resourceBlock(made.entries.find((e) => entryPath(e).endsWith('b.vpcf_c'))!.data, 'DATA').data);
  const init = at(kv.root, 'm_Initializers', 0);
  assert.equal((at(init, 'm_bUseMesh') as { type: number }).type, 14, 'mesh off');
  assert.equal((at(init, 'm_bUseBones') as { type: number }).type, 14, 'bones off');
  assert.equal(word(at(init, 'm_HitboxSetName')), SURFACE_SET);
  const ops = at(kv.root, 'm_Operators') as Extract<Kv3Node, { kind: 'array' }>;
  assert.deepEqual(ops.items.map((o) => word(at(o, '_class'))), ['C_OP_Decay', 'C_OP_LockToBone']);
});

test('a system that never starts on the model stays as it is', () => {
  assert.equal(surfaceSystem(read, 'particles/attached.vpcf'), null);
  assert.equal(surfaceSystem(read, 'particles/missing.vpcf'), null);
});

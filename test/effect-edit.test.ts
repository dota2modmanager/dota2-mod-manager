/* An effect changed by hand (src/effect-edit.ts) on systems built with the fields that matter, and
 * the record it goes in (src/effect-edit-service.ts). */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanEdits, editedEntries, systemsOf, WHOLE } from '../src/effect-edit.ts';
import { createEffectEdit } from '../src/effect-edit-service.ts';
import { readKv3, numberOf, type Kv3Block, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, entryPath, openVpkIndex } from '../src/vpk.ts';
import { at, encodeKv3, resource, rerl, type V } from './helpers/kv3-build.ts';

const op = (name: string, extra: [string, V][] = []): [string, V][] => [['_class', { str: name }], ...extra];
const literal = (v: number): V => ({ obj: [['m_nType', { str: 'PF_TYPE_LITERAL' }], ['m_flLiteralValue', { dbl: v }]] });
const uniform = (a: number, b: number): V => ({ obj: [['m_nType', { str: 'PF_TYPE_RANDOM_UNIFORM' }], ['m_flRandomMin', { dbl: a }], ['m_flRandomMax', { dbl: b }]] });
const curve: V = { obj: [['m_nType', { str: 'PF_TYPE_PARTICLE_AGE' }], ['m_flLiteralValue', { dbl: 7 }]] };

function system(fields: [string, V][]): Buffer {
  return resource([['RERL', rerl([])], ['DATA', encodeKv3({ obj: fields })]]);
}

const files = new Map<string, Buffer>([
  ['particles/a.vpcf_c', system([
    ['m_flConstantRadius', { dbl: 10 }], ['m_flConstantLifespan', { dbl: 2 }], ['m_nMaxParticles', { int: 40 }],
    ['m_ConstantColor', { i32s: [200, 100, 0, 255] }],
    ['m_Emitters', { objs: [op('C_OP_ContinuousEmitter', [['m_flEmitRate', literal(30)]])] }],
    ['m_Initializers', { objs: [
      op('C_INIT_RandomRadius', [['m_flRadiusMin', { dbl: 4 }], ['m_flRadiusMax', { dbl: 8 }]]),
      op('C_INIT_RandomLifeTime', [['m_fLifetimeMin', { dbl: 1 }], ['m_fLifetimeMax', { dbl: 3 }]]),
      op('C_INIT_CreateWithinSphere', [['m_fSpeedMin', uniform(5, 15)], ['m_fSpeedMax', curve]]),
    ] }],
    ['m_Children', { objs: [[['m_ChildRef', { str: 'particles/b.vpcf' }]]] }],
  ])],
  ['particles/b.vpcf_c', system([['m_flConstantRadius', { dbl: 3 }]])],
]);
const read = (p: string) => files.get(p);

const tree = (entries: ReturnType<typeof editedEntries>, name: string): Kv3Block => {
  const e = entries.find((x) => entryPath(x) === name);
  assert.ok(e, name);
  return readKv3(resourceBlock(e.data, 'DATA').data);
};
const n = (kv: Kv3Block, ...p: (string | number)[]) => numberOf(kv, at(kv.root, ...p) as Extract<Kv3Node, { kind: 'number' }>);

test('the sliders reach the numbers each one is about', () => {
  const kv = tree(editedEntries(read, 'particles/a.vpcf', { [WHOLE]: { size: 200, count: 150, life: 50, speed: 300 } }), 'particles/a.vpcf_c');
  assert.equal(n(kv, 'm_flConstantRadius'), 20);
  assert.equal(n(kv, 'm_Initializers', 0, 'm_flRadiusMax'), 16);
  assert.equal(n(kv, 'm_nMaxParticles'), 60);
  assert.equal(n(kv, 'm_Emitters', 0, 'm_flEmitRate', 'm_flLiteralValue'), 45);
  assert.equal(n(kv, 'm_flConstantLifespan'), 1);
  assert.equal(n(kv, 'm_Initializers', 1, 'm_fLifetimeMax'), 1.5);
  assert.equal(n(kv, 'm_Initializers', 2, 'm_fSpeedMin', 'm_flRandomMax'), 45);
});

test('a number the file computes is left to the file', () => {
  const kv = tree(editedEntries(read, 'particles/a.vpcf', { [WHOLE]: { speed: 300 } }), 'particles/a.vpcf_c');
  assert.equal(n(kv, 'm_Initializers', 2, 'm_fSpeedMax', 'm_flLiteralValue'), 7);
});

test('a colour takes the hue and keeps its brightness and its alpha', () => {
  const kv = tree(editedEntries(read, 'particles/a.vpcf', { [WHOLE]: { tint: '#00ff00' } }), 'particles/a.vpcf_c');
  assert.deepEqual([0, 1, 2, 3].map((i) => n(kv, 'm_ConstantColor', i)), [0, 200, 0, 255]);
});

test('a system takes its own changes on top of those on the whole effect', () => {
  const made = editedEntries(read, 'particles/a.vpcf', { [WHOLE]: { size: 200 }, 'particles/b.vpcf': { size: 150 } });
  assert.equal(n(tree(made, 'particles/a.vpcf_c'), 'm_flConstantRadius'), 20);
  assert.equal(n(tree(made, 'particles/b.vpcf_c'), 'm_flConstantRadius'), 9);
});

test('only what changed goes in the pak, under the path the game looks for', () => {
  const made = editedEntries(read, 'particles/a.vpcf', { 'particles/b.vpcf': { size: 150 } });
  assert.deepEqual(made.map(entryPath), ['particles/b.vpcf_c']);
  assert.deepEqual(systemsOf(read, 'particles/a.vpcf'), [{ path: 'particles/a.vpcf', depth: 0 }, { path: 'particles/b.vpcf', depth: 1 }]);
});

test('what the window sends is kept to what this knows, in range', () => {
  assert.deepEqual(cleanEdits({ [WHOLE]: { size: 9999, count: 100, tint: 'red' }, 'particles/A.vpcf': { life: 52 }, '../evil': { size: 200 }, 'particles/b.vpcf': { count: 100 } }),
    { [WHOLE]: { size: 300 }, 'particles/a.vpcf': { life: 50 } });
  assert.deepEqual(cleanEdits(null), {});
});

function world(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-fx-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([...files].map(([p, b]) => entryAt(p, b))));
  const userdata = path.join(dir, 'userdata');
  const installer = new Installer({ userDataDir: userdata, getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} } as never);
  const library = new Library(userdata);
  const service = createEffectEdit({ gamePath: () => game, installer, library, sprites: async () => ({}) });
  return { service, library, installer };
}

test('search takes every word, shortest path first', (t) => {
  const { service } = world(t);
  assert.deepEqual(service.search('particles b.vpcf'), ['particles/b.vpcf']);
  assert.deepEqual(service.search('   '), []);
  assert.deepEqual(service.search('nothing'), []);
});

test('one record per effect: built again in its place, and read back with its changes', async (t) => {
  const { service, library, installer } = world(t);
  const rec = service.install('particles/a.vpcf', { [WHOLE]: { size: 200 } });
  const again = service.install('particles/a.vpcf', { [WHOLE]: { size: 300 } });
  assert.equal(again.id, rec.id);
  assert.equal(library.list().length, 1);
  const pak = openVpkIndex(path.join(installer.langFolder(), again.files[0].relPath));
  const kv = readKv3(resourceBlock(pak.read('particles/a.vpcf_c') as Buffer, 'DATA').data);
  assert.equal(n(kv, 'm_flConstantRadius'), 30);
  const back = await service.load('particles/a.vpcf');
  assert.deepEqual(back.edits, { [WHOLE]: { size: 300 } });
  assert.equal(back.def.tree.m_flConstantRadius, 30, 'what plays is what was built');
  assert.deepEqual(service.saved(), [{ path: 'particles/a.vpcf', name: 'a' }]);
});

test('what plays follows the sliders, a change that reaches nothing says so, and a path that is no effect is refused', (t) => {
  const { service } = world(t);
  assert.equal(service.preview('particles/a.vpcf', { [WHOLE]: { size: 50 } })?.tree.m_flConstantRadius, 5);
  assert.throws(() => service.install('particles/b.vpcf', { [WHOLE]: { speed: 200 } }));
  assert.throws(() => service.preview('models/evil.vmdl', {}));
});

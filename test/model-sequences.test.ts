// A summon's model numbered as the plain one it goes under (src/model-sequences.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { numberedAs } from '../src/model-sequences.ts';
import { readKv3, numberOf, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { encodeKv3, resource, type V } from './helpers/kv3-build.ts';

type Seq = { name: string; act?: string; refs: number[]; layer?: V };

/** A model with only what numbering reads: the name list, and each sequence's fetch and layers. */
function model(names: string[], seqs: Seq[], multi: [string, V][][] = []): Buffer {
  const desc = (s: Seq): [string, V][] => [
    ['m_sName', { str: s.name }],
    ['m_fetch', { obj: [['m_localReferenceArray', { i32s: s.refs }]] }],
    ['m_autoLayerArray', { objs: s.layer ? [[['m_nLocalReference', s.layer]]] : [] }],
    ['m_activityArray', { objs: s.act ? [[['m_name', { str: s.act }], ['m_nWeight', { int: 1 }]]] : [] }],
  ];
  return resource([
    ['ASEQ', encodeKv3({ obj: [
      ['m_localSequenceNameArray', { arr: names.map((n) => ({ str: n })) }],
      ['m_localS1SeqDescArray', { objs: seqs.map(desc) }],
      ['m_localMultiSeqDescArray', { objs: multi }],
    ] })],
    ['DATA', encodeKv3({ obj: [['m_name', { str: 'a model' }]] })],
  ]);
}

/** The name list, and for each sequence the names its numbers point at. */
function read(file: Buffer) {
  const kv = readKv3(resourceBlock(file, 'ASEQ').data);
  const get = (n: Kv3Node | undefined, k: string) => (n?.kind === 'object' ? n.members.get(k) : undefined);
  const list = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
  const names = list(get(kv.root, 'm_localSequenceNameArray')).map((n) => (n.kind === 'string' ? n.value : ''));
  const at = (n: Kv3Node | undefined) => names[numberOf(kv, n as Extract<Kv3Node, { kind: 'number' }>)];
  const seqs = Object.fromEntries(list(get(kv.root, 'm_localS1SeqDescArray')).map((d) => [
    (get(d, 'm_sName') as { value: string }).value,
    { refs: list(get(get(d, 'm_fetch'), 'm_localReferenceArray')).map(at), layers: list(get(d, 'm_autoLayerArray')).map((l) => at(get(l, 'm_nLocalReference'))) },
  ]));
  return { names, seqs };
}

const PLAIN = model(['bindPose', 'spirit_run', 'spirit_idle'], [
  { name: 'bindPose', refs: [0] },
  { name: 'spirit_run', act: 'ACT_DOTA_RUN', refs: [1] },
  { name: 'spirit_idle', act: 'ACT_DOTA_IDLE', refs: [2] },
]);

test("a summon's model numbers its sequences as the plain one, every reference moved with its name", () => {
  /* Infernus lists the turns first: number 2, the plain idle, was its turn. Its run is named
     otherwise and found by its activity, its own name before the one played through it. */
  const infernus = model(['spirit_turns', 'spirit_runx', 'bindPose', 'spirit_idle', '@spirit_runx', '@@spirit_runx'], [
    { name: 'bindPose', refs: [2] },
    { name: 'spirit_idle', act: 'ACT_DOTA_IDLE', refs: [3] },
    { name: '@spirit_runx', act: 'ACT_DOTA_RUN', refs: [4] },
    // its layer is number 0, which the file stores as a type alone: it is written anew to change
    { name: 'spirit_runx', act: 'ACT_DOTA_RUN', refs: [5], layer: { i64zero: true } },
    { name: 'spirit_turns', refs: [0, 3] },
  ]);
  const before = read(infernus);
  const out = numberedAs(infernus, PLAIN);
  assert.ok(out);
  const after = read(out);
  assert.deepEqual(after.names, ['bindPose', 'spirit_runx', 'spirit_idle', 'spirit_turns', '@spirit_runx', '@@spirit_runx'],
    "the plain model's numbers first, the rest in their own order");
  assert.deepEqual(after.seqs, before.seqs, 'each sequence still fetches and layers what it did');
  assert.deepEqual(after.seqs.spirit_runx.layers, ['spirit_turns']);
});

test('a sequence with no activity is found by its name written another way', () => {
  // half of Invoker's spirits write bind_pose, and nothing else says which of theirs it is
  const out = numberedAs(model(['spirit_run', 'bind_pose', 'spirit_idle'], [
    { name: 'bind_pose', refs: [1] },
    { name: 'spirit_run', act: 'ACT_DOTA_RUN', refs: [0] },
    { name: 'spirit_idle', act: 'ACT_DOTA_IDLE', refs: [2] },
  ]), PLAIN);
  assert.ok(out);
  assert.deepEqual(read(out).names, ['bind_pose', 'spirit_run', 'spirit_idle']);
  assert.deepEqual(read(out).seqs.bind_pose.refs, ['bind_pose']);
});

test('a model numbered as the plain one already comes back as it is', () => {
  assert.equal(numberedAs(PLAIN, PLAIN), PLAIN);
});

test('a model that cannot stand for every plain sequence, or that this cannot renumber, is refused', () => {
  const noRun = model(['spirit_idle', 'bindPose'], [
    { name: 'bindPose', refs: [1] },
    { name: 'spirit_idle', act: 'ACT_DOTA_IDLE', refs: [0] },
  ]);
  assert.equal(numberedAs(noRun, PLAIN), null, 'nothing runs');
  const multi = model(['spirit_idle', 'spirit_run', 'bindPose'], [
    { name: 'bindPose', refs: [2] },
    { name: 'spirit_run', act: 'ACT_DOTA_RUN', refs: [1] },
    { name: 'spirit_idle', act: 'ACT_DOTA_IDLE', refs: [0] },
  ], [[['m_sName', { str: 'blend' }]]]);
  assert.equal(numberedAs(multi, PLAIN), null, 'a multi sequence points into the list in ways this does not move');
  assert.equal(numberedAs(Buffer.from('not a resource'), PLAIN), null);
});

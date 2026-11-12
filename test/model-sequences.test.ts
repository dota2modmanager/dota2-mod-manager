// A summon's model numbered as the plain one it goes under (src/model-sequences.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { numberedAs } from '../src/model-sequences.ts';
import { readKv3, numberOf, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { encodeKv3, resource, type V } from './helpers/kv3-build.ts';

type Seq = { name: string; act?: string; refs: number[] | V; layer?: V };

/** A model with only what numbering reads: the name list, and each sequence's fetch and layers. */
function model(names: string[], seqs: Seq[], multi: [string, V][][] = []): Buffer {
  const desc = (s: Seq): [string, V][] => [
    ['m_sName', { str: s.name }],
    ['m_fetch', { obj: [['m_localReferenceArray', Array.isArray(s.refs) ? { i32s: s.refs } : s.refs]] }],
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

// the Default Courier's, cut down: its turns play no activity, under names of the donkey's own
const DONKEY = model(['bindpose', 'donkey_idle', 'donkey_run', '@donkey_run', 'donkey_turns', '@donkey_turns_lookframe_0'], [
  { name: 'bindPose', refs: [0] },
  { name: 'donkey_idle', act: 'ACT_DOTA_IDLE', refs: [1] },
  { name: 'donkey_run', act: 'ACT_DOTA_RUN', refs: [3], layer: { int: 4 } },
  { name: 'donkey_turns', refs: [5] },
]);

test("a courier's parts are found by their names without the donkey's, whole or at the end", () => {
  // Drodo's turns are its run_turns, Murrissey's its turns
  const drodo = model(['run', 'bindPose', '@run_turns_lookFrame_0', 'idle', 'run_turns', '@run'], [
    { name: 'bindPose', refs: [1] },
    { name: 'idle', act: 'ACT_DOTA_IDLE', refs: [3] },
    { name: 'run', act: 'ACT_DOTA_RUN', refs: [5], layer: { int: 4 } },
    { name: 'run_turns', refs: [2] },
  ]);
  const before = read(drodo);
  const out = numberedAs(drodo, DONKEY);
  assert.ok(out);
  assert.deepEqual(read(out).names, ['bindPose', 'idle', 'run', '@run', 'run_turns', '@run_turns_lookFrame_0']);
  assert.deepEqual(read(out).seqs, before.seqs, 'each sequence still fetches and layers what it did');
});

test('a part the model has not got is stood for by one left over, an animation it plays never', () => {
  // the F2P courier has no turns: the server never sends their number, it picks by activity
  const out = numberedAs(model(['idle', 'bindPose', 'run', 'flap', '@run', 'shake'], [
    { name: 'bindPose', refs: [1] },
    { name: 'idle', act: 'ACT_DOTA_IDLE', refs: [0] },
    { name: 'run', act: 'ACT_DOTA_RUN', refs: [4] },
  ]), DONKEY);
  assert.ok(out);
  assert.deepEqual(read(out).names.slice(0, 4), ['bindPose', 'idle', 'run', '@run'], 'what plays an activity is where the donkey has it');
  // one with an activity is not stood for: the server would send its number
  assert.equal(numberedAs(model(['bindPose', 'run', '@run', 'a', 'b', 'c'], [
    { name: 'bindPose', refs: [0] },
    { name: 'run', act: 'ACT_DOTA_RUN', refs: [2] },
  ]), DONKEY), null, 'no idle');
});

// #403: the flying donkey runs two ways and a courier flies one, so the second run found nothing
// left, the whole flying model was dropped, and the courier turned into the donkey once it flew.
const WINGS = model(['bindpose', 'donkey_wings_die', 'donkey_wings_idle', 'donkey_wings_run', 'donkey_wings_run_alt'], [
  { name: 'bindPose', refs: [] },
  { name: 'donkey_wings_die', act: 'ACT_DOTA_DIE', refs: [1] },
  { name: 'donkey_wings_idle', act: 'ACT_DOTA_IDLE', refs: [2] },
  { name: 'donkey_wings_run', act: 'ACT_DOTA_RUN', refs: [3] },
  { name: 'donkey_wings_run_alt', act: 'ACT_DOTA_RUN', refs: [4] },
]);

/** The activity each name plays in the file, by the server's number. */
function playedAt(file: Buffer): (string | null)[] {
  const kv = readKv3(resourceBlock(file, 'ASEQ').data);
  const get = (n: Kv3Node | undefined, k: string) => (n?.kind === 'object' ? n.members.get(k) : undefined);
  const list = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
  const str = (n: Kv3Node | undefined) => (n?.kind === 'string' ? n.value : '');
  const acts = new Map(list(get(kv.root, 'm_localS1SeqDescArray')).map((d) => [str(get(d, 'm_sName')), str(get(list(get(d, 'm_activityArray'))[0], 'm_name')) || null]));
  return list(get(kv.root, 'm_localSequenceNameArray')).map((n) => acts.get(str(n)) ?? null);
}

test("a courier with one flying run plays it for both of the donkey's, rather than being the donkey", () => {
  const filmtail = model(['bindPose', 'flying_run', 'flying_idle', 'flying_spawn', 'flying_death'], [
    { name: 'bindPose', refs: [] },
    { name: 'flying_run', act: 'ACT_DOTA_RUN', refs: [1] },
    { name: 'flying_idle', act: 'ACT_DOTA_IDLE', refs: [2] },
    { name: 'flying_spawn', act: 'ACT_DOTA_SPAWN', refs: [3] },
    { name: 'flying_death', act: 'ACT_DOTA_DIE', refs: [4] },
  ]);
  const out = numberedAs(filmtail, WINGS);
  assert.ok(out, 'the flying model is kept');
  const { names, seqs } = read(out);
  assert.deepEqual(playedAt(out).slice(0, 5), [null, 'ACT_DOTA_DIE', 'ACT_DOTA_IDLE', 'ACT_DOTA_RUN', 'ACT_DOTA_RUN'], 'each of the donkey\'s numbers plays what the donkey plays there');
  assert.equal(names[4], 'donkey_wings_run_alt', 'the stand-in goes under the donkey\'s name');
  assert.deepEqual(seqs.donkey_wings_run_alt.refs, seqs.flying_run.refs, 'and plays the courier\'s own run');
  assert.deepEqual(seqs.flying_run.refs, ['flying_run']);
  assert.deepEqual(seqs.flying_spawn.refs, ['flying_spawn'], 'what the donkey has not got stays, after its names');
});

test("a missing rare idle is the courier's idle, played as the rare one, and a missing part is its bind pose", () => {
  const plain = model(['bindPose', 'donkey_idle', 'donkey_idle_alt', 'donkey_run', 'donkey_turns'], [
    { name: 'bindPose', refs: [] },
    { name: 'donkey_idle', act: 'ACT_DOTA_IDLE', refs: [1] },
    { name: 'donkey_idle_alt', act: 'ACT_DOTA_IDLE_RARE', refs: [2] },
    { name: 'donkey_run', act: 'ACT_DOTA_RUN', refs: [3] },
    { name: 'donkey_turns', refs: [4] },
  ]);
  const sennin = model(['bindPose', 'courier_run', 'courier_idle'], [
    { name: 'bindPose', refs: [] },
    { name: 'courier_run', act: 'ACT_DOTA_RUN', refs: [1] },
    { name: 'courier_idle', act: 'ACT_DOTA_IDLE', refs: [2] },
  ]);
  const out = numberedAs(sennin, plain);
  assert.ok(out);
  assert.deepEqual(playedAt(out), [null, 'ACT_DOTA_IDLE', 'ACT_DOTA_IDLE_RARE', 'ACT_DOTA_RUN', null]);
  const { names, seqs } = read(out);
  assert.deepEqual(names, ['bindPose', 'courier_idle', 'donkey_idle_alt', 'courier_run', 'donkey_turns']);
  assert.deepEqual(seqs.donkey_idle_alt.refs, ['courier_idle']);
  assert.deepEqual(seqs.donkey_turns.refs, [], 'the turns hold their number with the bind pose, which plays nothing');
});

test('a reference stored as a type alone can be moved without the model coming out unreadable', () => {
  // Spooly and Brightskye: the compiler writes a fetch of [1] as a typed array whose element type
  // is the number one itself. Moved to 2 among such elements, every value after it shifted.
  const spooly = model(['bindPose', 'courier_run', 'courier_idle'], [
    { name: 'bindPose', refs: [] },
    { name: 'courier_run', act: 'ACT_DOTA_RUN', refs: { typedOnes: 1 } },
    { name: 'courier_idle', act: 'ACT_DOTA_IDLE', refs: [2] },
  ]);
  const idleFirst = model(['bindPose', 'donkey_idle', 'donkey_run'], [
    { name: 'bindPose', refs: [] },
    { name: 'donkey_idle', act: 'ACT_DOTA_IDLE', refs: [1] },
    { name: 'donkey_run', act: 'ACT_DOTA_RUN', refs: [2] },
  ]);
  const out = numberedAs(spooly, idleFirst);
  assert.ok(out);
  const { names, seqs } = read(out);
  assert.deepEqual(names, ['bindPose', 'courier_idle', 'courier_run'], 'the run moved from 1 to 2');
  assert.deepEqual(seqs.courier_run.refs, ['courier_run'], 'the run still fetches its own clip, from its new place');
  assert.deepEqual(seqs.courier_idle.refs, ['courier_idle']);
});

/**
 * The mod doctor (src/mod-doctor.ts): each check is a bug that reached the game in the built
 * arcana of issue #118 and took somebody playing it to find. The mods here are made of the same
 * parts the game's files are: a model's sequences in ASEQ, a particle's children and points.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { examine, type Finding } from '../src/mod-doctor.ts';
import { buildVpk, entryAt } from '../src/vpk.ts';
import { encodeKv3, host, model, resource, rerl, type V } from './helpers/kv3-build.ts';

const MODEL = 'models/heroes/terrorblade/terrorblade.vmdl_c';

/** The doctor's findings for a mod of these files, against a game of those. */
function findings(t: { after: (fn: () => void) => void }, mod: [string, Buffer][], game: [string, Buffer][]): Finding[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-doctor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = (name: string, files: [string, Buffer][]) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, buildVpk(files.map(([p, b]) => entryAt(p, b))));
    return file;
  };
  return examine({ mod: at('mod_dir.vpk', mod), pak01: at('pak01_dir.vpk', game.length ? game : [['readme.txt', Buffer.from('x')]]) });
}

const what = (list: Finding[]) => list.map((f) => `${f.level}: ${f.file}`);

test('a model whose attack needs a modifier only an item turns on is an error; one the game turns on is not', (t) => {
  const found = findings(t, [[MODEL, model('models/heroes/terrorblade/terrorblade.vmdl', [
    ['attack', ['ACT_DOTA_ATTACK', 'abysm']],
    // below a share of health only, so it is no attack for a hero standing healthy
    ['attack_injured', ['ACT_DOTA_ATTACK', 'injured']],
    ['run', ['ACT_DOTA_RUN']],
    ['spawn', ['ACT_DOTA_SPAWN', 'loadout']],
  ])]], []);
  assert.deepEqual(what(found), [`error: ${MODEL}`, `error: ${MODEL}`]);
  assert.match(found[0].what, /ACT_DOTA_ATTACK plays only with the modifier "abysm" in its clips/);
  assert.match(found[1].what, /in its sequences/);
  const fixed = findings(t, [[MODEL, model('models/heroes/terrorblade/terrorblade.vmdl', [['attack', ['ACT_DOTA_ATTACK']], ['run', ['ACT_DOTA_RUN']]])]], []);
  assert.deepEqual(fixed, [], 'with the modifier taken off, nothing to say');
});

test('the clips are read as well as the sequences, and an activity named again is a modifier', (t) => {
  // the sequences fixed and the clips not: the game picks by the clips, and the arcana stood still
  const clipsOnly = findings(t, [[MODEL, model('models/heroes/terrorblade/terrorblade.vmdl',
    [['attack', ['ACT_DOTA_ATTACK']]], [['attack', ['ACT_DOTA_ATTACK', 'abysm']]])]], []);
  assert.deepEqual(clipsOnly.map((f) => f.what.match(/in its (clips|sequences)/)?.[1]), ['clips']);
  // "abysm" pointed at the activity instead of taken off: the game played nothing all the same
  const named = findings(t, [[MODEL, model('models/heroes/terrorblade/terrorblade.vmdl', [['attack', ['ACT_DOTA_ATTACK', 'ACT_DOTA_ATTACK']]])]], []);
  assert.match(named[0].what, /ACT_DOTA_ATTACK plays only with the modifier "ACT_DOTA_ATTACK"/);
});

test('a model in another order than the game has at its path is a warning, and another name inside a note', (t) => {
  const found = findings(t,
    [[MODEL, model('models/heroes/terrorblade/terrorblade_arcana.vmdl', [['attack', ['ACT_DOTA_ATTACK']], ['run', ['ACT_DOTA_RUN']]])]],
    [[MODEL, model('models/heroes/terrorblade/terrorblade.vmdl', [['attack', ['ACT_DOTA_ATTACK']], ['idle', ['ACT_DOTA_IDLE']], ['run', ['ACT_DOTA_RUN']]])]]);
  assert.deepEqual(what(found), [`warning: ${MODEL}`, `note: ${MODEL}`]);
  assert.match(found[0].what, /sequence 1 is "run" here and "idle"/);
});

/** A particle that draws itself on `attachment`, its preview's control point 0. */
const drawnOn = (attachment: string) => resource([['RERL', rerl([])], ['DATA', encodeKv3({ obj: [
  ['m_controlPointConfigurations', { arr: [{ obj: [['m_drivers', { arr: [{ obj: [['m_attachmentName', { str: attachment }]] }] }]] }] }],
] })]]);

/** The eyes as the first build had them: two children, a point handed to the first only. */
function eyes(second: string): Buffer {
  const children = ['particles/eye.vpcf', second];
  return resource([['RERL', rerl(children)], ['DATA', encodeKv3({ obj: [
    ['m_Children', { arr: children.map((c): V => ({ obj: [['m_ChildRef', { ref: c }]] })) }],
    ['m_controlPointConfigurations', { arr: [{ obj: [['m_drivers', { arr: [{ obj: [['m_attachmentName', { str: 'attach_eye_r' }]] }] }]] }] }],
    ['m_PreEmissionOperators', { arr: [{ obj: [['_class', { str: 'C_OP_SetParentControlPointsToChildCP' }], ['m_nNumControlPoints', { int: 1 }]] }] }],
  ] })]]);
}

test("a child left on its parent's first point is an error only when it is made for another attachment", (t) => {
  const PARENT = 'particles/eyes.vpcf_c';
  const glow = findings(t, [[PARENT, eyes('particles/body.vpcf')], ['particles/body.vpcf_c', drawnOn('attach_hitloc')]],
    [['particles/eye.vpcf_c', drawnOn('attach_eye_r')]]);
  assert.deepEqual(what(glow), [`error: ${PARENT}`], "the chest glow at the right eye (issue #118)");
  assert.match(glow[0].what, /made for attach_hitloc but gets the parent's first point, on attach_eye_r/);
  // Valve hangs children on the parent's first point all the time, where they are made for it
  const shared = findings(t, [[PARENT, eyes('particles/eye_glint.vpcf')], ['particles/eye_glint.vpcf_c', drawnOn('attach_eye_r')]],
    [['particles/eye.vpcf_c', drawnOn('attach_eye_r')]]);
  assert.deepEqual(shared, []);
});

test('a child that neither the mod nor the game has is an error', (t) => {
  const found = findings(t, [['particles/eyes.vpcf_c', host(['particles/gone.vpcf'])]], []);
  assert.deepEqual(what(found), ['error: particles/eyes.vpcf_c']);
  assert.match(found[0].what, /child particles\/gone\.vpcf is in neither the mod nor the game/);
});

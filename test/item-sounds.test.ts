// An item's sounds and voice as a mod gives them (src/item-sounds.ts): plain events rewritten as the
// item's, in every soundevents file that has them, and a hero's plain lines voiced as its arcana's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readKv3, numberOf, type Kv3Node } from '../src/kv3.ts';
import { dataBlock } from '../src/resource.ts';
import { buildVpk, entryAt, entryPath } from '../src/vpk.ts';
import { soundEntries, voiceSwaps } from '../src/item-sounds.ts';
import { at, encodeKv3, resource, type V } from './helpers/kv3-build.ts';

const criterion = (name: string, key: string, expr: string): V => ({ obj: [['m_name', { str: name }], ['m_matchKey', { str: key }], ['m_matchExpr', { str: expr }]] });
const group = (name: string, req: string[], lines: string[]): V => ({ obj: [
  ['m_name', { str: name }],
  ['m_responses', { arr: lines.map((l) => ({ obj: [['m_type', { str: 'SPEAK' }], ['m_value', { str: l }]] })) }],
  ['m_pEmbeddedRule', { obj: [['m_name', { str: name }], ['m_Requirements', { arr: req.map((r) => ({ str: r })) }]] }],
] });

/** A hero's response rules, as Earthshaker's are laid out: the arcana's lines ask for its criterion. */
const RULES: V = { obj: [
  ['m_Requirements', { arr: [
    criterion('IsX', 'classname', 'npc_dota_hero_x'),
    criterion('IsArc', 'customresponse', 'x_arc'),
    criterion('IsNotArc', 'customresponse', '!=x_arc'),
    criterion('IsLate', 'gametime', '>2400'),
  ] }],
  ['m_ResponseGroups', { arr: [
    group('x_Kill', ['Kill', 'IsX', 'IsNotArc'], ['x_kill_1', 'x_kill_2', 'x_kill_3']),
    group('x_KillIsArc', ['Kill', 'IsX', 'IsArc'], ['x_arc_kill_1', 'x_arc_kill_2']),
    group('x_Spawn', ['Spawn', 'IsX'], ['x_spawn_1']),
    // the arcana has no plain spawn, only a late one: the plain spawn takes that
    group('x_SpawnIsArcIsLate', ['Spawn', 'IsX', 'IsArc', 'IsLate'], ['x_arc_spawn_late']),
    group('x_Deny', ['Deny', 'IsX'], ['x_deny_1']),
  ] }],
] };

test("a hero's plain lines are voiced as the arcana's said in the same situation", () => {
  const rules = readKv3(encodeKv3(RULES)).root;
  assert.deepEqual(voiceSwaps(rules, { key: 'customresponse', value: 'x_arc' }), [
    { sound: 'x_kill_1', as: 'x_arc_kill_1' },
    { sound: 'x_kill_2', as: 'x_arc_kill_2' },
    { sound: 'x_kill_3', as: 'x_arc_kill_1' },
    { sound: 'x_spawn_1', as: 'x_arc_spawn_late' },
  ], 'a deny the arcana has no line for keeps the plain voice');
  assert.deepEqual(voiceSwaps(rules, { key: 'customresponse', value: 'another_item' }), [], 'a criterion the rules never ask for voices nothing');
});

/** Invoker's rules as the Acolyte of the Lost Arts has them: the plain lines ask that he is not the
 *  "happy" Acolyte either, and some are said by chance; the Acolyte's ask for neither. */
const KID: V = { obj: [
  ['m_Requirements', { arr: [
    criterion('IsInvoker', 'classname', 'npc_dota_hero_invoker'),
    criterion('IsKid', 'customresponse', 'kid_persona'),
    criterion('IsOld', 'customresponse', '!=kid_persona'),
    criterion('IsNotHappy', 'customresponse', '!=happy_kidvoker'),
    criterion('Chance_5', 'randomnum', '>95'),
  ] }],
  ['m_ResponseGroups', { arr: [
    group('invo_Select', ['Select', 'IsInvoker', 'IsOld', 'IsNotHappy', 'Chance_5'], ['invo_rare_1', 'invo_rare_2']),
    group('invo_Kill', ['Kill', 'IsInvoker', 'IsOld', 'IsNotHappy'], ['invo_kill_1']),
    group('kid_Select', ['Select', 'IsInvoker', 'IsKid'], ['kid_rare_1']),
    group('kid_Kill', ['Kill', 'IsInvoker', 'IsKid'], ['kid_kill_1']),
  ] }],
] };

test("a persona's voice takes every plain line it has a situation for, an arcana's only the close ones", () => {
  const rules = readKv3(encodeKv3(KID)).root;
  assert.deepEqual(voiceSwaps(rules, { key: 'customresponse', value: 'kid_persona' }), [],
    'as an arcana: no rule of the Acolyte asks what the plain ones do, so none matched, and he spoke as the plain Invoker');
  assert.deepEqual(voiceSwaps(rules, { key: 'customresponse', value: 'kid_persona', whole: true }), [
    { sound: 'invo_rare_1', as: 'kid_rare_1' },
    { sound: 'invo_rare_2', as: 'kid_rare_1' },
    { sound: 'invo_kill_1', as: 'kid_kill_1' },
  ]);
});

const event = (file: string, extra: [string, V][] = []): V => ({ obj: [
  ['type', { str: 'dota_update_default' }], ['volume', { dbl: 0.5 }], ['vsnd_files', { arr: [{ str: file }] }], ...extra,
] });
const events = (list: [string, V][]) => resource([['RED2', Buffer.from('editor')], ['DATA', encodeKv3({ obj: list })]]);

test('an item sound and a voice go into every soundevents file that has the plain event, all in one copy each', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-sounds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  const lines = ['x_kill_1', 'x_kill_2', 'x_kill_3', 'x_arc_kill_1', 'x_arc_kill_2', 'x_spawn_1', 'x_arc_spawn_late', 'x_deny_1'];
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), buildVpk([
    entryAt('scripts/talker/response_rules_x.vrr_c', resource([['DATA', encodeKv3(RULES)]])),
    entryAt('soundevents/voscripts/game_sounds_vo_x.vsndevts_c', events(lines.map((l) => [l, event(`sounds/vo/x/${l}.vsnd`)]))),
    // the hero picker says the spawn line too, and which copy plays is not ours to guess
    entryAt('soundevents/game_sounds_hero_pick.vsndevts_c', events([['x_spawn_1', event('sounds/vo/x/x_spawn_1.vsnd')]])),
    entryAt('soundevents/game_sounds_heroes/game_sounds_x.vsndevts_c', events([['X.Totem', event('sounds/x/totem.vsnd')]])),
    entryAt('soundevents/game_sounds_items.vsndevts_c', events([['X.Totem.Immortal', event('sounds/x/totem.vsnd', [['soundevent_layer2', { str: 'X.Totem.Immortal.Layer' }]])]])),
  ]));

  const out = soundEntries(dir,
    [{ sound: 'X.Totem', as: 'X.Totem.Immortal' }, { sound: 'X.Gone', as: 'X.Totem.Immortal' }, { sound: 'X.Totem', as: 'X.Removed' }],
    [{ hero: 'npc_dota_hero_x', key: 'customresponse', value: 'x_arc' }]);
  assert.deepEqual(out.map(entryPath).sort(), [
    'soundevents/game_sounds_hero_pick.vsndevts_c',
    'soundevents/game_sounds_heroes/game_sounds_x.vsndevts_c',
    'soundevents/voscripts/game_sounds_vo_x.vsndevts_c',
  ], "the items file is only read; an event the game has not got changes nothing");

  const file = (p: string) => {
    const kv = readKv3(dataBlock(out.find((e) => entryPath(e) === p)!.data).data);
    return { kv, ev: (name: string) => at(kv.root, name) };
  };
  const vsnd = (n: Kv3Node) => ((at(n, 'vsnd_files') as Extract<Kv3Node, { kind: 'array' }>).items[0] as { value: string }).value;
  const hero = file('soundevents/game_sounds_heroes/game_sounds_x.vsndevts_c');
  assert.equal((at(hero.ev('X.Totem'), 'soundevent_layer2') as { value: string }).value, 'X.Totem.Immortal.Layer', 'the totem plays as the immortal one');
  assert.equal(numberOf(hero.kv, at(hero.ev('X.Totem'), 'volume') as Extract<Kv3Node, { kind: 'number' }>), 0.5, 'a number copied from another file keeps its value');

  const vo = file('soundevents/voscripts/game_sounds_vo_x.vsndevts_c');
  assert.equal(vsnd(vo.ev('x_kill_3')), 'sounds/vo/x/x_arc_kill_1.vsnd');
  assert.equal(vsnd(vo.ev('x_spawn_1')), 'sounds/vo/x/x_arc_spawn_late.vsnd');
  assert.equal(vsnd(vo.ev('x_deny_1')), 'sounds/vo/x/x_deny_1.vsnd');
  assert.equal(vsnd(vo.ev('x_arc_kill_1')), 'sounds/vo/x/x_arc_kill_1.vsnd', "the arcana's own lines are left as they are");
  const pick = file('soundevents/game_sounds_hero_pick.vsndevts_c');
  assert.equal(vsnd(pick.ev('x_spawn_1')), 'sounds/vo/x/x_arc_spawn_late.vsnd', 'the second copy of the line too');

  assert.deepEqual(soundEntries(dir, [], []), [], 'nothing asked, nothing read');
});

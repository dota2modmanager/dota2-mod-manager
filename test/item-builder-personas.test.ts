/* Personas in the item builder (src/item-builder-personas.ts): which of the plain hero's slots
 * each of a persona's slots goes under, what a build takes with a persona on, which files win over
 * the persona's base, and a persona's pick written over the plain hero's stock item.
 *
 * The promise to the user: with a persona picked the hero wears the persona's items and nothing
 * else, the game's own where nothing is picked, and the plain hero's picks stay out. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  displaced, isSelectorSlot, leftOut, personaAssets, personaLayouts, personaRecords, personasOn, personaSlots, personaScales, personaScaleOf,
} from '../src/item-builder-personas.ts';
import { ARCANA_BASES, readyBase } from '../src/arcana-bases.ts';
import { encodeKv3, resource } from './helpers/kv3-build.ts';
import { itemEffectPatch } from '../src/item-builder.ts';
import { entryAt, entryPath } from '../src/vpk.ts';
import type { LibRecord } from '../src/types.ts';

const PUDGE = '"used_by_heroes"\n\t\t\t{\n\t\t\t\t"npc_dota_hero_pudge"\t\t"1"\n\t\t\t}';
const item = (id: string, name: string, prefab: string, slot: string, model = '', visuals = '') => [
  `\t\t"${id}"`, '\t\t{',
  `\t\t\t"name"\t\t"${name}"`, `\t\t\t"prefab"\t\t"${prefab}"`,
  ...(slot ? [`\t\t\t"item_slot"\t\t"${slot}"`] : []),
  ...(model ? [`\t\t\t"model_player"\t\t"${model}"`] : []),
  `\t\t\t${PUDGE}`,
  ...(visuals ? [`\t\t\t"visuals"\n\t\t\t{\n${visuals}\n\t\t\t}`] : []),
  '\t\t}',
].join('\n');
const modifier = (fields: Record<string, string>) => `\t\t\t\t"asset_modifier"\n\t\t\t\t{\n${Object.entries(fields).map(([k, v]) => `\t\t\t\t\t"${k}"\t\t"${v}"`).join('\n')}\n\t\t\t\t}`;

/** Pudge as the game has him, cut down: four plain slots, the Toy Butcher and three of its slots. */
const TABLE = ['"items_game"', '{', '\t"items"', '\t{',
  item('47', "Pudge's Rusty Meathook", 'default_item', '', 'models/heroes/pudge/righthook.vmdl'),
  item('258', "Pudge's Back Rings and Apron", 'default_item', 'back', 'models/heroes/pudge/back.vmdl'),
  item('260', "Pudge's Left Arm", 'default_item', 'shoulder', 'models/heroes/pudge/leftarm.vmdl'),
  item('262', "Pudge's Toupee", 'default_item', 'head', 'models/heroes/pudge/hair.vmdl'),
  item('709', "Pudge's Persona", 'default_item', 'persona_selector'),
  item('13786', 'The Toy Butcher', 'wearable', 'persona_selector', '', [
    modifier({ type: 'persona', persona: '1' }),
    modifier({ type: 'entity_model', asset: 'npc_dota_hero_pudge', modifier: 'models/heroes/pudge_cute/pudge_cute.vmdl' }),
    modifier({ type: 'particle', asset: 'particles/units/heroes/hero_pudge/pudge_meathook.vpcf', modifier: 'particles/units/heroes/hero_pudge_cute/pudge_cute_meathook.vpcf' }),
    modifier({ type: 'icon_replacement_hero_minimap', asset: 'npc_dota_hero_pudge', modifier: 'npc_dota_hero_pudge_persona1' }),
    modifier({ type: 'ability_icon', asset: 'pudge_rot', modifier: 'pudge/persona_toy_butcher/pudge_rot_persona1' }),
  ].join('\n')),
  item('696', 'Pudge Persona Weapon', 'default_item', 'weapon_persona_1', 'models/heroes/pudge_cute/pudge_cute_hook.vmdl'),
  item('712', 'Pudge Persona Costume', 'default_item', 'armor_persona_1', 'models/heroes/pudge_cute/pudge_cute_costume.vmdl'),
  item('713', 'Pudge Persona Head', 'default_item', 'head_persona_1', 'models/heroes/pudge_cute/pudge_cute_hair.vmdl'),
  item('50001', 'Toy Hook', 'wearable', 'weapon_persona_1', 'models/items/pudge_cute/toy_hook.vmdl'),
  item('50002', 'Plain Hook', 'wearable', '', 'models/items/pudge/plain_hook.vmdl'),
  '\t}', '}', ''].join('\n');

const pick = (id: string, slot: string, itemId: string, enabled = true): LibRecord =>
  ({ id, name: id, categoryId: 'cosmetic', files: [], slot: `item:pudge:${slot}`, itemId, enabled });

test("each of a persona's slots goes under a plain one: its own name first, then a model nobody took", () => {
  const pudge = personaLayouts(TABLE).get('pudge')!;
  assert.equal(pudge.selector.id, '709');
  assert.deepEqual(pudge.personas.map((p) => p.id), ['13786']);
  assert.deepEqual(pudge.parts.map((p) => [p.slot, p.host.id, p.given?.id]), [
    ['head_persona_1', '262', '713'],
    ['weapon_persona_1', '47', '696'],
    ['armor_persona_1', '260', '712'], // no plain armour: the shoulders, the first model left
  ]);
  assert.deepEqual(pudge.parts[1].options.map((o) => o.name), ['Toy Hook'], 'a paid item of the slot is offered in it');
});

test('the builder offers a slot to pick the persona in, and one for each of its own', () => {
  const slots = personaSlots(TABLE);
  assert.deepEqual(slots.map((s) => [s.slot, s.targetId, s.persona]), [
    ['item:pudge:persona_selector', '709', { hero: 'pudge', part: false }],
    ['item:pudge:head_persona_1', '262', { hero: 'pudge', part: true }],
    ['item:pudge:weapon_persona_1', '47', { hero: 'pudge', part: true }],
    ['item:pudge:armor_persona_1', '260', { hero: 'pudge', part: true }],
  ]);
  assert.deepEqual(slots[0].options, [{ id: '13786', name: 'The Toy Butcher' }]);
  assert.ok(isSelectorSlot(slots[0].slot) && !isSelectorSlot(slots[2].slot));
});

test("with the persona on the hero wears its items alone, the game's own where nothing is picked", () => {
  const records = [pick('persona', 'persona_selector', '13786'), pick('plain', 'weapon', '50002'), pick('toy', 'weapon_persona_1', '50001')];
  const { records: built, left } = personaRecords(records, TABLE);
  assert.deepEqual(left.map((l) => [l.rec.id, l.why]), [['plain', 'the hero has a persona on']]);
  assert.deepEqual(built.map((r) => [r.id, r.itemId, r.persona?.target, r.persona?.host, r.persona?.given]), [
    ['persona', '13786', '709', null, false],
    ['toy', '50001', '47', 'models/heroes/pudge/righthook.vmdl_c', false],
    ['persona:pudge:head_persona_1', '713', '262', 'models/heroes/pudge/hair.vmdl_c', true],
    ['persona:pudge:armor_persona_1', '712', '260', 'models/heroes/pudge/leftarm.vmdl_c', true],
  ], "the picked hook takes the weapon; the head and the costume are the game's");
  assert.deepEqual(displaced(records).map((r) => r.id), ['plain'], 'a pick of the persona switches the plain hook off');
});

test('without the persona the plain picks go in as before, and a persona slot\'s pick stays out', () => {
  const records = [pick('plain', 'weapon', '50002'), pick('toy', 'weapon_persona_1', '50001'), pick('off', 'persona_selector', '13786', false)];
  assert.equal(personasOn(records).size, 0, 'a persona switched off is not on');
  const { records: built, left } = personaRecords(records, TABLE);
  assert.deepEqual(built.map((r) => r.id), ['plain', 'off']);
  assert.deepEqual(left.map((l) => [l.rec.id, l.why]), [['toy', 'its persona is not on']]);
  assert.equal(leftOut({ id: 'x', name: 'x', categoryId: 'cursor', files: [] }, personasOn(records)), null, 'not a builder pick');
  assert.deepEqual(displaced(records), []);
});

test('only the personas with a base are offered, one per hero', () => {
  const personas = ARCANA_BASES.filter((b) => b.persona);
  assert.equal(personas.length, 11);
  assert.equal(new Set(personas.map((b) => b.hero)).size, 11);
  for (const b of personas) assert.deepEqual(b.parts, [b.item], `${b.id}: its own slots' items win over its base`);
});

const EMPTY = Buffer.alloc(2059);
const REAL = Buffer.alloc(20000, 1);

test("over the persona's base a slot's pick wins at its own model, and the game's own only over an empty one", () => {
  const base = ARCANA_BASES.find((b) => b.id === 'the_toy_butcher')!;
  const ready = [readyBase(base, [
    entryAt('models/heroes/pudge/pudge.vmdl_c', REAL),
    entryAt('models/heroes/pudge/righthook.vmdl_c', EMPTY),
    entryAt('models/heroes/pudge/leftarm.vmdl_c', REAL), // rebuilt by hand, as Mirana's mount is
    entryAt('particles/fixed.vpcf_c', REAL),
  ])];
  const files = (host: string) => [entryAt(host, Buffer.from('the item')), entryAt('particles/fixed.vpcf_c', Buffer.from("Valve's")), entryAt('particles/own.vpcf_c', Buffer.from('own'))];
  const rec = (host: string, given: boolean) => ({ ...pick('p', 'weapon_persona_1', '1'), persona: { target: '47', host, given } });
  const kept = (host: string, given: boolean) => personaAssets(rec(host, given), files(host), ready).map(entryPath);
  const hook = 'models/heroes/pudge/righthook.vmdl_c';
  const arm = 'models/heroes/pudge/leftarm.vmdl_c';
  assert.deepEqual(kept(hook, false), [hook, 'particles/own.vpcf_c'], "a pick: its model, not the base's particle");
  assert.deepEqual(kept(hook, true), [hook, 'particles/own.vpcf_c'], "the game's own over an empty model");
  assert.deepEqual(kept(arm, true), ['particles/own.vpcf_c'], 'a part rebuilt by hand stays');
  assert.deepEqual(kept(arm, false), [arm, 'particles/own.vpcf_c'], 'a pick over it is still what was picked');
});

test("a persona's pick is written over the plain hero's stock item, and the persona's switch is taken off", () => {
  const hook = itemEffectPatch(TABLE, '50001', '', '47');
  assert.equal(hook.id, '47');
  assert.match(hook.block, /"name"\s+"Pudge's Rusty Meathook"/);
  assert.match(hook.block, /"model_player"\s+"models\/heroes\/pudge\/righthook.vmdl"/);
  assert.match(hook.block, /"item_slot"\s+"weapon"/, 'the plain slot: weapon_persona_1 is not one the plain hero wears');
  assert.match(itemEffectPatch(TABLE, '712', '', '260').block, /"item_slot"\s+"shoulder"/);
  assert.deepEqual(hook.assetCopies[0], { from: 'models/items/pudge_cute/toy_hook.vmdl', to: 'models/heroes/pudge/righthook.vmdl' });

  const persona = itemEffectPatch(TABLE, '13786', '', '709');
  assert.equal(persona.id, '709');
  assert.doesNotMatch(persona.block, /"type"\s+"persona"/, 'switched, the game would put on the persona\'s own stock items');
  assert.doesNotMatch(persona.block, /entity_model/, 'the body is the base, under the plain path');
  assert.match(persona.block, /pudge_cute_meathook/, 'its particles stay');
});

test("a persona's pictures: its portrait in the top bar and the hero picker as well as the minimap, and its ability icons", () => {
  const pictures = itemEffectPatch(TABLE, '13786', '', '709').assetCopies
    .flatMap((c) => ('to' in c && c.to.startsWith('panorama/') ? [`${c.from} -> ${c.to}`] : []));
  assert.deepEqual(pictures.sort(), [
    'panorama/images/heroes/icons/npc_dota_hero_pudge_persona1_png.vtex_c -> panorama/images/heroes/icons/npc_dota_hero_pudge_png.vtex_c',
    'panorama/images/heroes/npc_dota_hero_pudge_persona1_png.vtex_c -> panorama/images/heroes/npc_dota_hero_pudge_png.vtex_c',
    'panorama/images/heroes/selection/npc_dota_hero_pudge_persona1_png.vtex_c -> panorama/images/heroes/selection/npc_dota_hero_pudge_png.vtex_c',
    'panorama/images/spellicons/pudge/persona_toy_butcher/pudge_rot_persona1_png.vtex_c -> panorama/images/spellicons/pudge_rot_png.vtex_c',
  ], 'the persona names only the minimap one; the game has the same name for the other two');
});

test("a persona's items are made as big as its body is against Valve's, measured, and only in its own slots", () => {
  const body = (s: number) => resource([['DATA', encodeKv3({ obj: [['m_modelSkeleton', { obj: [
    ['m_boneName', { arr: [{ str: 'pelvis' }, { str: 'head' }] }],
    ['m_bonePosParent', { arr: [{ f64s: [0, 0, 55 * s] }, { f64s: [0, 3 * s, 20 * s] }] }],
  ] }]] })]]);
  const game: Record<string, Buffer> = {
    'scripts/npc/heroes/npc_dota_hero_invoker.txt': Buffer.from('"DOTAHeroes"\n{\n\t"npc_dota_hero_invoker"\n\t{\n\t\t"Model"\t\t"models/heroes/invoker/invoker.vmdl"\n'
      + '\t\t"Persona"\n\t\t{\n\t\t\t"1"\n\t\t\t{\n\t\t\t\t"Model"\t\t"models/heroes/invoker_kid/invoker_kid.vmdl"\t// For tools only\n\t\t\t}\n\t\t}\n\t}\n}'),
    'models/heroes/invoker_kid/invoker_kid.vmdl_c': body(1),
  };
  const read = (p: string) => game[p] ?? null;
  const acolyte = ARCANA_BASES.find((b) => b.persona && b.hero === 'invoker')!;
  const on = new Map([['invoker', acolyte.item]]);
  const based = (s: number) => [readyBase(acolyte, [entryAt('models/heroes/invoker/invoker.vmdl_c', body(s))])];
  assert.deepEqual([...personaScales(on, based(1.351), read)], [['invoker', 1.351]], 'the body compiled at 1/0.74');
  assert.deepEqual([...personaScales(on, based(1), read)], [], "one compiled as Valve's: nothing to scale");
  assert.deepEqual([...personaScales(new Map(), based(1.351), read)], [], 'the persona not on');
  assert.deepEqual([...personaScales(on, [], read)], [], 'its base not here');

  const scales = new Map([['invoker', 1.351]]);
  const persona = { target: '1', host: null, given: false };
  const own = { id: 'a', name: 'Hair', categoryId: 'cosmetic', files: [], slot: 'item:invoker:head_persona_1', itemId: '9', persona };
  assert.equal(personaScaleOf(own, scales), 1.351);
  assert.equal(personaScaleOf({ ...own, slot: 'item:invoker:persona_selector' }, scales), undefined, 'not the persona itself');
  assert.equal(personaScaleOf({ ...own, persona: undefined }, scales), undefined, 'not a plain pick');
  assert.equal(personaScaleOf({ ...own, slot: 'item:pudge:weapon_persona_1' }, scales), undefined, "not another hero's");
});

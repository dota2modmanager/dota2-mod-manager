/* Kinetic gems (src/item-builder-kinetic.ts): read from the table, offered by hero, worn on a pick. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kineticGems, offeredKinetic } from '../src/item-builder-kinetic.ts';
import { effectKey, itemEffectPatch } from '../src/item-builder.ts';

const gem = (id: string, name: string, asset: string, modifier = name) => `\t\t"${id}"\n\t\t{\n\t\t\t"name"\t\t"${name}"\n\t\t\t"loc_key"\t\t"#DOTA_Anim_Mod_${name}"\n\t\t\t"0"\n\t\t\t{\n\t\t\t\t"type"\t\t"activity"\n\t\t\t\t"asset"\t\t"${asset}"\n\t\t\t\t"modifier"\t\t"${modifier}"\n\t\t\t}\n\t\t}\n`;
const icon = '\t\t"139"\n\t\t{\n\t\t\t"name"\t\t"some_icon"\n\t\t\t"asset_modifier0"\n\t\t\t{\n\t\t\t\t"type"\t\t"ability_icon"\n\t\t\t\t"asset"\t\t"a"\n\t\t\t\t"modifier"\t\t"b"\n\t\t\t}\n\t\t}\n';
const item = (id: string, name: string, prefab: string) => `\t\t"${id}"\n\t\t{\n\t\t\t"name"\t\t"${name}"\n\t\t\t"prefab"\t\t"${prefab}"\n\t\t\t"item_slot"\t\t"weapon"\n\t\t\t"model_player"\t\t"models/${name}.vmdl"\n\t\t\t"used_by_heroes"\n\t\t\t{\n\t\t\t\t"npc_dota_hero_lion"\t\t"1"\n\t\t\t}\n\t\t\t"visuals"\n\t\t\t{\n\t\t\t}\n\t\t}\n`;
const TEXT = `"items_game"\n{\n\t"items"\n\t{\n${item('1', 'stock', 'default_item')}${item('2', 'paid', 'wearable')}\t}\n\t"asset_modifiers"\n\t{\n${gem('35', 'fishstick', 'ALL')}${gem('38', 'rampant', 'ALL')}${gem('86', 'dc_centaur_double_edge', 'ACT_DOTA_CAST_ABILITY_2', 'unbroken')}${icon}\t}\n}\n`;

test('the table gives the gems and nothing else of its asset modifiers', () => {
  const gems = kineticGems(TEXT);
  assert.deepEqual([...gems.keys()], ['fishstick', 'rampant', 'dc_centaur_double_edge']);
  assert.deepEqual(gems.get('dc_centaur_double_edge')!.activities, [['ACT_DOTA_CAST_ABILITY_2', 'unbroken']]);
});

test('a hero is offered the gems their model can play', () => {
  assert.deepEqual(offeredKinetic(TEXT, ['npc_dota_hero_lion']).map((g) => g.id), ['kinetic-fishstick']);
  assert.deepEqual(offeredKinetic(TEXT, ['npc_dota_hero_axe']).map((g) => g.nameToken), ['#DOTA_Anim_Mod_rampant']);
  assert.deepEqual(offeredKinetic(TEXT, ['npc_dota_hero_meepo']), []);
});

test('a pick wears a gem in the table and asks for the hero model without its modifier', () => {
  const patch = itemEffectPatch(TEXT, '2', 'kinetic-fishstick');
  assert.match(patch.block, /"type"\s+"activity"\s+"asset"\s+"ALL"\s+"modifier"\s+"fishstick"/);
  assert.deepEqual(patch.kinetic, ['fishstick']);
  assert.deepEqual(patch.heroes, ['npc_dota_hero_lion']);
});

test('a gem stays in the effect string, and one the table has not got refuses the pick', () => {
  assert.equal(effectKey('style-1,kinetic-fishstick,fire'), 'fire,kinetic-fishstick,style-1');
  assert.throws(() => itemEffectPatch(TEXT, '2', 'kinetic-nothing'), /kinetic-nothing/);
});

/* The game's unusual effects on any item (src/item-builder-unusual.ts, issue #393): a named effect
 * that starts at the model is offered and goes into the pick's visuals as a `particle_create`; an
 * eye glow, an unnamed number and a system the builder already offers are left out; the token
 * rides in the effect string after the builder's own effects. */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as builder from '../src/item-builder.ts';
import { offeredUnusual } from '../src/item-builder-unusual.ts';
import { ITEM_EFFECTS } from '../src/item-builder-effects.ts';

const effect = (id: number, system: string, attach: string) => `
		"${id}"
		{
			"system"		"${system}"
			"attach_type"		"${attach}"
		}`;

const TABLE = `"items_game"
{
	"items"
	{
		"400"
		{
			"name"		"Magnus' Horn"
			"prefab"		"default_item"
			"item_slot"		"head"
			"model_player"		"models/heroes/magnataur/horn.vmdl"
			"used_by_heroes"
			{
				"npc_dota_hero_magnataur"		"1"
			}
		}
		"9001"
		{
			"name"		"Plain Hat"
			"prefab"		"wearable"
			"item_slot"		"head"
			"model_player"		"models/items/magnus/9001.vmdl"
			"used_by_heroes"
			{
				"npc_dota_hero_magnataur"		"1"
			}
		}
	}
	"attribute_controlled_attached_particles"
	{${effect(15, 'particles/econ/courier/courier_trail_01.vpcf', 'absorigin_follow')}${effect(17, 'particles/econ/courier/eyes_glow.vpcf', 'customorigin')}${effect(21, 'particles/econ/courier/sunfire.vpcf', 'absorigin_follow')}${effect(30, 'particles/econ/courier/unnamed.vpcf', 'absorigin_follow')}${effect(40, ITEM_EFFECTS[0].modifier, 'absorigin_follow')}
	}
}
`;

const NAMED = new Set([15, 17, 21, 40]);

test('the picker offers named effects that start at the model, and none the builder already has', () => {
  assert.deepEqual(offeredUnusual(TABLE, (id) => NAMED.has(id)), [
    { id: 'unusual-15', nameToken: '#Attrib_Particle15' },
    { id: 'unusual-21', nameToken: '#Attrib_Particle21' },
  ]);
});

test('a game effect rides after the builder ones, by number, and before the style', () => {
  const own = ITEM_EFFECTS[0].id;
  assert.equal(builder.effectKey(`style-2,unusual-21,${own},unusual-15`), `${own},unusual-15,unusual-21,style-2`);
});

test("a pick wears the effect's particle as a particle_create", () => {
  const { block } = builder.itemEffectPatch(TABLE, '9001', 'unusual-15');
  assert.match(block, /"type"\s+"particle_create"[\s\S]*courier_trail_01\.vpcf/);
  assert.doesNotMatch(block, /sunfire/);
});

test('a number the table does not have refuses the pick', () => {
  assert.throws(() => builder.itemEffectPatch(TABLE, '9001', 'unusual-99999'), /unusual-99999/);
});

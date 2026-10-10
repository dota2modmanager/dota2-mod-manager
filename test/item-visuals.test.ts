/* What an item does to the game and what a build from the game's files has to do for it
 * (src/item-visuals.ts), on a table shaped like the game's items_game: an arcana that swaps the
 * hero's model and needs its own activity modifier, and the free item of its slot. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, defaultItem, findItems, itemVisuals } from '../src/item-visuals.ts';

const TABLE = `"items_game"
{
	"items"
	{
		"500"
		{
			"name"		"Default Horns"
			"prefab"		"default_item"
			"baseitem"		"1"
			"item_slot"		"head"
			"model_player"		"models/heroes/terrorblade/horns.vmdl"
			"used_by_heroes"
			{
				"npc_dota_hero_terrorblade"		"1"
			}
		}
		"5957"
		{
			"name"		"Fractal Horns of Inner Abysm"
			"prefab"		"wearable"
			"item_slot"		"head"
			"model_player"		"models/heroes/terrorblade/horns_arcana.vmdl"
			"used_by_heroes"
			{
				"npc_dota_hero_terrorblade"		"1"
			}
			"visuals"
			{
				"asset_modifier"
				{
					"type"		"entity_model"
					"asset"		"npc_dota_hero_terrorblade"
					"modifier"		"models/heroes/terrorblade/terrorblade_arcana.vmdl"
				}
				"asset_modifier"
				{
					"type"		"activity"
					"asset"		"ALL"
					"modifier"		"abysm"
				}
				"asset_modifier"
				{
					"type"		"particle_create"
					"modifier"		"particles/body_arcana.vpcf"
				}
				"asset_modifier"
				{
					"type"		"custom_kill_effect"
					"asset"		"kill"
					"modifier"		"modifier_kill_effect"
				}
				"styles"
				{
					"0"
					{
						"name"		"#arcana_style"
					}
				}
			}
		}
	}
}
`;

test("an item's changes are read from its visuals, with its slot, hero and own model", () => {
  const v = itemVisuals(TABLE, 5957)!;
  assert.equal(v.name, 'Fractal Horns of Inner Abysm');
  assert.equal(v.slot, 'head');
  assert.deepEqual(v.heroes, ['npc_dota_hero_terrorblade']);
  assert.equal(v.model, 'models/heroes/terrorblade/horns_arcana.vmdl');
  assert.deepEqual(v.styles, ['#arcana_style']);
  assert.deepEqual(v.modifiers.map((m) => [m.type, m.modifier]), [
    ['entity_model', 'models/heroes/terrorblade/terrorblade_arcana.vmdl'],
    ['activity', 'abysm'],
    ['particle_create', 'particles/body_arcana.vpcf'],
    ['custom_kill_effect', 'modifier_kill_effect'],
  ]);
  assert.equal(itemVisuals(TABLE, 1), null);
  assert.deepEqual(findItems(TABLE, 'fractal').map((i) => i.id), ['5957']);
  assert.deepEqual(defaultItem(TABLE, 'npc_dota_hero_terrorblade', 'head'), { id: '500', model: 'models/heroes/terrorblade/horns.vmdl' });
});

test('the plan says what a build gives, what is done by hand, and what only the item can give', () => {
  const plan = buildPlan(TABLE, itemVisuals(TABLE, 5957)!);
  assert.deepEqual(plan.map((s) => s.done), ['built', 'built', 'built', 'by hand', 'cannot']);
  assert.match(plan[0].how, /horns_arcana\.vmdl under models\/heroes\/terrorblade\/horns\.vmdl/, "the item's own model in the place of the free one");
  assert.match(plan[2].how, /animation clips \(ANIM\)/, 'the modifier comes off the clips, which the game picks by');
});

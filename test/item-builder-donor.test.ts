/* Another item's effect on the one worn (src/item-builder-donor.ts, issue #383): Magnus' plain hat
 * with the particles of the immortal one. The donor's own particle and the stock effect it
 * replaces go into the worn item's visuals, unnumbered, once each; the worn item's own replacement
 * of the same stock effect wins; the restyled ability's icon and sound come along (issue #534); and
 * the picker offers as donors the items with a particle of their own, created or replacing one. */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as builder from '../src/item-builder.ts';
import { itemSlots } from '../src/item-builder-slots.ts';

const wearable = (id: string, name: string, visuals: string) => `
		"${id}"
		{
			"name"		"${name}"
			"prefab"		"wearable"
			"item_slot"		"head"
			"model_player"		"models/items/magnus/${id}.vmdl"
			"used_by_heroes"
			{
				"npc_dota_hero_magnataur"		"1"
			}
			"visuals"
			{
${visuals}
			}
		}`;
const modifier = (key: string, type: string, asset: string, mod: string, style = '') => `				"${key}"
				{
					"type"		"${type}"
					"asset"		"${asset}"
					"modifier"		"${mod}"${style ? `\n\t\t\t\t\t"style"		"${style}"` : ''}
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
		}${wearable('9001', 'Plain Hat', modifier('asset_modifier', 'particle', 'particles/units/heroes/hero_magnataur/magnataur_shockwave.vpcf', 'particles/plain/shockwave.vpcf'))}${wearable('9002', 'Immortal Hat', [
  modifier('asset_modifier0', 'particle_create', 'particles/immortal/hat_ambient.vpcf', 'particles/immortal/hat_ambient.vpcf'),
  modifier('asset_modifier1', 'particle', 'particles/units/heroes/hero_magnataur/magnataur_shockwave.vpcf', 'particles/immortal/shockwave.vpcf'),
  modifier('asset_modifier2', 'particle', 'particles/units/heroes/hero_magnataur/magnataur_skewer.vpcf', 'particles/immortal/skewer.vpcf'),
  modifier('asset_modifier3', 'particle_create', 'particles/immortal/golden.vpcf', 'particles/immortal/golden.vpcf', '1'),
].join('\n'))}${wearable('9003', 'Bare Hat', '')}${wearable('9004', 'Astral Hat', [
  modifier('asset_modifier', 'particle', 'particles/units/heroes/hero_magnataur/magnataur_reverse_polarity.vpcf', 'particles/astral/polarity.vpcf'),
  modifier('asset_modifier', 'ability_icon', 'magnataur_reverse_polarity', 'magnataur/astral/reverse_polarity'),
  modifier('asset_modifier', 'sound', 'Hero_Magnataur.ReversePolarity.Cast', 'Hero_Magnataur.ReversePolarity.Astral'),
].join('\n'))}
	}
}
`;

test("a pick wears the donor's particle and the stock effect it replaces, beside its own", () => {
  const { block } = builder.itemEffectPatch(TABLE, '9001', 'from-9002');
  const count = (s: string) => block.split(s).length - 1;
  assert.equal(count('particles/immortal/hat_ambient.vpcf'), 2, 'the ambient particle, asset and modifier once');
  assert.equal(count('particles/immortal/skewer.vpcf'), 1, 'the skewer the plain hat leaves alone');
  assert.equal(count('particles/immortal/shockwave.vpcf'), 0, "the plain hat's own shockwave wins");
  assert.equal(count('particles/plain/shockwave.vpcf'), 1);
  assert.equal(count('golden.vpcf'), 0, 'a particle of a style the pick is not in');
  assert.doesNotMatch(block, /"asset_modifier\d"/, 'unnumbered, so nothing clashes');
  assert.match(block, /"name"\s+"Magnus' Horn"/, 'still the stock item');
});

test('the donor rides in the effect string after the effects and before the style', () => {
  assert.equal(builder.effectKey('style-2,from-9002,fire'), 'fire,from-9002,style-2');
  assert.equal(builder.effectKey(['from-9002']), 'from-9002');
  const both = builder.itemEffectPatch(TABLE, '9001', 'fire,from-9002');
  assert.match(both.block, /courier_trail_lava/);
  assert.match(both.block, /hat_ambient/);
});

test('a donor with no effect, or not in the table, refuses the pick', () => {
  assert.throws(() => builder.itemEffectPatch(TABLE, '9001', 'from-9003'), /9003/);
  assert.throws(() => builder.itemEffectPatch(TABLE, '9001', 'from-12345'), /12345/);
});

test('the picker marks the items with a particle of their own', () => {
  const head = itemSlots(TABLE).find((s) => s.slot.includes('head'))!;
  // the Astral and Plain hats only restyle an ability, which is an effect to give too (issue #534)
  assert.deepEqual(head.options.map((o) => [o.name, !!o.fx]), [['Astral Hat', true], ['Bare Hat', false], ['Immortal Hat', true], ['Plain Hat', true]]);
});

test("an ability's new effect comes with its icon and its sound (issue #534)", () => {
  const pick = builder.itemEffectPatch(TABLE, '9003', 'from-9004');
  assert.match(pick.block, /"ability_icon"/);
  assert.ok(pick.block.includes('magnataur/astral/reverse_polarity'));
  assert.ok(pick.block.includes('Hero_Magnataur.ReversePolarity.Astral'));
  const to = pick.assetCopies.flatMap((c) => ('to' in c ? [String(c.to)] : []));
  assert.ok(to.includes('panorama/images/spellicons/magnataur_reverse_polarity_png.vtex_c'), "the icon under the stock ability's picture");
  assert.ok(to.includes('particles/units/heroes/hero_magnataur/magnataur_reverse_polarity.vpcf'), 'the particle under the stock path');
  assert.deepEqual(pick.sounds, [{ sound: 'Hero_Magnataur.ReversePolarity.Cast', as: 'Hero_Magnataur.ReversePolarity.Astral' }]);
});

test("the worn item's own icon for an ability wins over the donor's", () => {
  const own = builder.itemEffectPatch(TABLE, '9004', 'from-9004');
  assert.equal(own.block.split('magnataur/astral/reverse_polarity').length - 1, 1);
});

/* The game's unusual and ethereal effects (src/unusual-effects.ts), on a table shaped like
 * items_game's "attribute_controlled_attached_particles" and lines like dota_english.txt's. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectNames, unusualEffects } from '../src/unusual-effects.ts';

const TABLE = `"items_game"
{
	"items"
	{
		"4"
		{
			"system"		"particles/not/an/effect.vpcf"
		}
	}
	"attribute_controlled_attached_particles"
	{
		"4"
		{
			"system"		"particles/econ/courier/courier_selfmade/courier_selfmade.vpcf"
			"attach_type"		"rootbone_follow"
			"attach_entity"		"parent"
		}
		"17"
		{
			"system"		"particles/econ/courier/courier_eye_glow_01/courier_eye_glow_01.vpcf"
			"attach_type"		"customorigin"
			"control_points"
			{
				"0"
				{
					"control_point_index"		"0"
					"attach_type"		"point_follow"
					"attachment"		"attach_eye_r"
				}
				"1"
				{
					"control_point_index"		"1"
					"attach_type"		"point_follow"
					"attachment"		"attach_eye_l"
				}
			}
		}
		"900"
		{
			"attach_type"		"absorigin_follow"
		}
	}
}
`;

const ENGLISH = `"lang"
{
	"Tokens"
	{
		"Attrib_Particle4"							"Self-Made Aura"
		"Attrib_Particle17"							"Luminous Gaze"
		"Attrib_Particle_Desc"							"not one"
	}
}`;

test('the names players know, by effect number', () => {
  assert.deepEqual([...effectNames(ENGLISH)], [[4, 'Self-Made Aura'], [17, 'Luminous Gaze']]);
});

test('each effect with its particle, how it attaches and its points; one with no particle is left out', () => {
  assert.deepEqual(unusualEffects(TABLE, ENGLISH), [
    { id: 4, name: 'Self-Made Aura', system: 'particles/econ/courier/courier_selfmade/courier_selfmade.vpcf', attachType: 'rootbone_follow', points: [] },
    {
      id: 17, name: 'Luminous Gaze', system: 'particles/econ/courier/courier_eye_glow_01/courier_eye_glow_01.vpcf', attachType: 'customorigin',
      points: [
        { index: 0, attachType: 'point_follow', attachment: 'attach_eye_r' },
        { index: 1, attachType: 'point_follow', attachment: 'attach_eye_l' },
      ],
    },
  ]);
  assert.equal(unusualEffects(TABLE)[0].name, null);
  assert.deepEqual(unusualEffects('"items_game"\n{\n}\n'), []);
});

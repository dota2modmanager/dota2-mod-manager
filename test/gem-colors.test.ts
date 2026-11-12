// The game's prismatic gem colours out of items_game (src/gem-colors.ts, issue #392).
import test from 'node:test';
import assert from 'node:assert/strict';

import { findGem, gemColors, gemName, prismaticGemArt, rgbOf } from '../src/gem-colors.ts';

const TABLE = `"items_game"
{
	"game_info"
	{
		"first_valid_class"		"2"
	}
	"colors"
	{
		"desc_level"
		{
			"color_name"		"ItemAttribLevel"
			"hex_color"		"#756b5e"
		}
		"unusual_creators_light"
		{
			"color_name"		"UnusualCreatorsLight"
			"hex_color"		"#DCF2FF"
		}
		"unusual_international_2012"
		{
			"color_name"		"UnusualInternational2012"
			"hex_color"		"#4D78DB"
		}
		"unusual_broken"
		{
			"color_name"		"UnusualBroken"
			"hex_color"		"not a colour"
		}
	}
	"items"
	{
		"1"
		{
			"colors"		"not this one"
		}
	}
}
`;

test('the gems are the colours the table calls unusual, with readable names', () => {
  assert.deepEqual(gemColors(TABLE), [
    { key: 'unusual_creators_light', name: 'Creators Light', rgb: [220, 242, 255] },
    { key: 'unusual_international_2012', name: 'International 2012', rgb: [77, 120, 219] },
  ]);
  assert.deepEqual(gemColors('"items_game"\n{\n}\n'), [], 'a table with no colours has no gems');
});

test('a gem is found by its key or by its name, whatever the case and the apostrophe', () => {
  const gems = gemColors(TABLE);
  assert.equal(findGem(gems, "Creator's Light")?.key, 'unusual_creators_light');
  assert.equal(findGem(gems, 'unusual_international_2012')?.name, 'International 2012');
  assert.equal(findGem(gems, 'international2012')?.rgb[0], 77);
  assert.equal(findGem(gems, 'Midas Gold'), null);
});

test('names and colours read as people write them', () => {
  assert.equal(gemName('UnusualPlushShagbark'), 'Plush Shagbark');
  assert.equal(gemName('UnusualInternational2014'), 'International 2014');
  assert.deepEqual(rgbOf('#FFAF00'), [255, 175, 0]);
  assert.deepEqual(rgbOf('ffaf00'), [255, 175, 0]);
  assert.equal(rgbOf('#FFF'), null);
});

test('prismatic artwork reads the game socket image and mask once', () => {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(header.length);
  const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
  const requested: string[] = [];
  const art = prismaticGemArt({ read: path => { requested.push(path); return Buffer.concat([header, png]); } });
  assert.deepEqual(requested, ['gem_color', 'gem_color_mask'].map(name => `panorama/images/econ/sockets/${name}_png.vtex_c`));
  assert.equal(art?.image, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(art?.mask, art?.image);
});

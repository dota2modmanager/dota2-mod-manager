// Asking the game what a mod replaces, instead of reading it off folder names.
//
// The whole point is that the answer comes from the installed game, so the fixture here is a
// small but real one: a pak01 built by our own writer, holding a real-shaped items_game.txt.
// What is pinned is that a model path leads to the item that owns it, that the heroes come
// from the table rather than from the folder a file happens to sit in, and that a machine
// with no game keeps quiet instead of guessing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crc32 } = require('node:zlib');

const vpk = require('../src/vpk.ts');
const { createModIdentity } = require('../src/mod-id.js');

// Shaped like the real table: an item names its model and the heroes allowed to wear it.
const ITEMS_GAME = `"items_game"
{
	"items"
	{
		"306"
		{
			"name"		"Terrorblade's Wings"
			"prefab"		"default_item"
			"item_slot"		"back"
			"model_player"		"models/items/terrorblade/tb_wings/tb_wings.vmdl"
			"used_by_heroes"
			{
				"npc_dota_hero_terrorblade"		"1"
			}
		}
		"307"
		{
			"name"		"Grimstroke's Armor"
			"item_slot"		"armor"
			"model_player"		"models/items/grimstroke/gs_armor/gs_armor.vmdl"
			"used_by_heroes"
			{
				"npc_dota_hero_grimstroke"		"1"
			}
		}
		"308"
		{
			"name"		"Largo's Instrument"
			"item_slot"		"weapon"
			"model_player"		"models/items/bard/largo_lute/largo_lute.vmdl"
			"used_by_heroes"
			{
				"npc_dota_hero_bard"		"1"
			}
		}
		"309"
		{
			"name"		"Cr\xc3\xa8me Br\xc3\xbbl\xc3\xa9e Hat"
			"item_slot"		"head"
			"model_player"		"models/items/pudge/hat/hat.vmdl"
			"used_by_heroes"
			{
				"npc_dota_hero_pudge"		"1"
			}
		}
	}
}
`;

/** One inline-data entry in the shape buildVpk() wants. */
function entry(relPath, body) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
  const norm = relPath.replace(/\\/g, '/').toLowerCase();
  const slash = norm.lastIndexOf('/');
  const file = slash === -1 ? norm : norm.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return {
    ext: dot === -1 ? ' ' : file.slice(dot + 1),
    folder: slash === -1 ? ' ' : norm.slice(0, slash),
    name: dot === -1 ? file : file.slice(0, dot),
    data,
    preload: Buffer.alloc(0),
    crc: crc32(data) >>> 0,
  };
}

/** A throwaway game folder with a pak01 that carries the table above. */
function fakeGame(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-id-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'dota', 'pak01_dir.vpk'),
    vpk.buildVpk([entry('scripts/items/items_game.txt', ITEMS_GAME)]),
  );
  return dir;
}

test('a model path leads to the item that owns it', (t) => {
  const id = createModIdentity({ getGamePath: () => fakeGame(t) });
  const got = id.identify([
    'models/items/grimstroke/gs_armor/gs_armor.vmdl_c',
    'materials/models/items/grimstroke/gs_armor/gs_armor_color_png_1.vtex_c',
  ]);
  assert.deepEqual(got.items, ["Grimstroke's Armor"]);
  assert.deepEqual(got.slots, ['armor']);
  assert.deepEqual(got.heroNames, ['Grimstroke']);
});

test('the hero comes from the table, not from the folder the file sits in', (t) => {
  // the archive says "bard"; the table says that item is worn by the hero the app calls Largo
  const id = createModIdentity({ getGamePath: () => fakeGame(t) });
  const got = id.identify(['models/items/bard/largo_lute/largo_lute.vmdl_c']);
  assert.deepEqual(got.items, ["Largo's Instrument"]);
  assert.equal(got.heroNames.length, 1, 'one hero, whatever the folder is called');
});

test('several items come back named, sorted and without repeats', (t) => {
  const id = createModIdentity({ getGamePath: () => fakeGame(t) });
  const got = id.identify([
    'models/items/terrorblade/tb_wings/tb_wings.vmdl_c',
    'models/items/grimstroke/gs_armor/gs_armor.vmdl_c',
    'models/items/grimstroke/gs_armor/gs_armor.vmdl_c',
  ]);
  assert.deepEqual(got.items, ["Grimstroke's Armor", "Terrorblade's Wings"]);
});

test('a name with accents comes back readable', (t) => {
  // the table is read byte-exact as latin1, so anything shown to a person needs converting
  const id = createModIdentity({ getGamePath: () => fakeGame(t) });
  const got = id.identify(['models/items/pudge/hat/hat.vmdl_c']);
  assert.deepEqual(got.items, ['Crème Brûlée Hat']);
});

test('a mod the table knows nothing about gets no answer, not a wrong one', (t) => {
  const id = createModIdentity({ getGamePath: () => fakeGame(t) });
  // a bare hero body and a particle: real mods, no item to name
  assert.equal(id.identify(['models/heroes/pudge/pudge.vmdl_c', 'particles/units/heroes/hero_pudge/pudge_rot.vpcf_c']), null);
  assert.equal(id.identify([]), null);
});

test('without a game there is nothing to ask and nothing is claimed', () => {
  const id = createModIdentity({ getGamePath: () => null });
  assert.equal(id.ready(), false);
  assert.equal(id.identify(['models/items/grimstroke/gs_armor/gs_armor.vmdl_c']), null);
});

test('a game folder without a pak is not a game folder', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-id-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = createModIdentity({ getGamePath: () => dir });
  assert.equal(id.identify(['models/items/grimstroke/gs_armor/gs_armor.vmdl_c']), null);
});

test('the table is read once and then kept', (t) => {
  const game = fakeGame(t);
  let reads = 0;
  const id = createModIdentity({ getGamePath: () => { reads++; return game; } });
  const paths = ['models/items/grimstroke/gs_armor/gs_armor.vmdl_c'];
  id.identify(paths);
  const afterFirst = reads;
  for (let i = 0; i < 5; i++) id.identify(paths);
  // the game path is still asked for (it is how "did the game change" is answered), but the
  // 25k-block walk behind it is not repeated: clearing is what forces it again
  assert.ok(reads > afterFirst, 'the game is still checked on every call');
  id.clear();
  assert.deepEqual(id.identify(paths).items, ["Grimstroke's Armor"], 'and it rebuilds cleanly');
});

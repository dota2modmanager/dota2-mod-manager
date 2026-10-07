/* The model of Dota's loader in tools/sim/dota.js, on a game folder built here from nothing.
 *
 * The simulation runs it after every scripted click to ask whether the game would load what the
 * app left behind. A model that misreads the folder would pass a broken install or fail a good
 * one, so these pin the rules it applies: the mount order the search paths give, the lowest pak
 * number winning inside a folder, a byte flipped inside one of our packs, and an item block that
 * points at a model nothing ships.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crc32 } = require('zlib');
const { buildVpk } = require('../src/vpk.ts');
const dota = require('../tools/sim/dota.js');

const SEARCH = `"GameInfo"
{
	FileSystem
	{
		SearchPaths
		{
			Game_AudioLanguage	dota_*LANGUAGE*
			Game_LowViolence	dota_lv
			Game				dota
			Game				core
			Mod					dota
		}
	}
}
`;
const SCHEMA = '"items_game"\r\n{\r\n\t"items"\r\n\t{\r\n\t\t"1"\r\n\t\t{\r\n\t\t\t"name"\t"stock"\r\n\t\t}\r\n\t\t"2"\r\n\t\t{\r\n\t\t\t"model_player"\t"models/heroes/x/x.vmdl"\r\n\t\t}\r\n\t}\r\n}\r\n';

function entry(rel, text) {
  const data = Buffer.from(text);
  const ext = path.extname(rel).slice(1);
  return { ext, folder: path.dirname(rel), name: path.basename(rel, `.${ext}`), data, preload: Buffer.alloc(0), crc: crc32(data) >>> 0 };
}

/* A whole Steam library, not just a game folder. src/gamelang.ts looks for launch options four
   levels above the game, and when it finds no Steam user there it asks the Steam installed on the
   machine; the first draft of this test built a bare folder and read the developer's own
   "-language dutch" out of their real Steam. */
function game(t) {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-dota-'));
  t.after(() => fs.rmSync(lib, { recursive: true, force: true }));
  const root = path.join(lib, 'steamapps', 'common', 'dota 2 beta', 'game');
  fs.mkdirSync(path.join(lib, 'userdata', '1234', 'config'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'userdata', '1234', 'config', 'localconfig.vdf'), '"UserLocalConfigStore"\n{\n}\n');
  const g = (...p) => path.join(root, ...p);
  for (const d of ['dota/cfg', 'dota_russian', 'core', 'bin/win64']) fs.mkdirSync(g(d), { recursive: true });
  fs.writeFileSync(g('dota/gameinfo.gi'), SEARCH);
  fs.writeFileSync(g('dota/gameinfo_branchspecific.gi'), SEARCH);
  fs.writeFileSync(g('dota/cfg/boot.vcfg'), '"boot"\n{\n\t"UILanguage"\t\t"english"\n\t"AudioLanguage"\t\t"russian"\n}\n');
  fs.writeFileSync(g('dota/pak01_dir.vpk'), buildVpk([entry('scripts/items/items_game.txt', SCHEMA), entry('models/heroes/x/x.vmdl_c', 'valve model')]));
  return { root, g };
}

test('the language folder mounts first, then the ones gameinfo names, and only folders that exist', (t) => {
  const { root } = game(t);
  assert.deepEqual(dota.mountOrder(root), ['dota_russian', 'dota', 'core']);
});

test('a branch file naming a language key the engine no longer reads mounts no language folder', (t) => {
  // Build 6946 renamed Game_Language to Game_AudioLanguage. A search path copied before the
  // update keeps the old name, and the engine skips that line: mods in dota_russian go unread.
  const { root, g } = game(t);
  fs.writeFileSync(g('dota/gameinfo_branchspecific.gi'), SEARCH.replace('Game_AudioLanguage\t', 'Game_Language\t\t'));
  assert.deepEqual(dota.mountOrder(root), ['dota', 'core']);
  assert.deepEqual(dota.unknownLanguageKeys(root), ['Game_Language']);
  assert.ok(dota.checkGame(root).problems.some((p) => p.includes('Game_Language')), 'and the check says why');
});

test('the language key the engine reads is the one in Valve\'s own gameinfo.gi', (t) => {
  const { root, g } = game(t);
  const old = SEARCH.replace('Game_AudioLanguage\t', 'Game_Language\t\t');
  fs.writeFileSync(g('dota/gameinfo.gi'), old);
  fs.writeFileSync(g('dota/gameinfo_branchspecific.gi'), old);
  assert.deepEqual(dota.mountOrder(root), ['dota_russian', 'dota', 'core'], 'an older build still mounts by the older key');
  assert.deepEqual(dota.unknownLanguageKeys(root), []);
});

test('inside a folder the lowest pak number wins, and an earlier folder wins over a later one', (t) => {
  const { root, g } = game(t);
  fs.writeFileSync(g('dota_russian/pak03_dir.vpk'), buildVpk([entry('panorama/a.txt', 'three')]));
  fs.writeFileSync(g('dota_russian/pak02_dir.vpk'), buildVpk([entry('panorama/a.txt', 'two')]));
  const loaded = dota.load(root);
  assert.deepEqual(loaded.resolve('panorama/a.txt'), { folder: 'dota_russian', pak: 'pak02_dir.vpk' });
  assert.equal(loaded.read('panorama/a.txt').toString(), 'two');
  assert.deepEqual(loaded.resolve('models/heroes/x/x.vmdl_c'), { folder: 'dota', pak: 'pak01_dir.vpk' });
  assert.equal(loaded.resolve('nothing/here.txt'), null);
});

test('a byte flipped inside one of our packs is a problem the game would meet', (t) => {
  const { root, g } = game(t);
  const pak = buildVpk([entry('panorama/a.txt', 'intact text')]);
  pak[pak.indexOf(Buffer.from('intact'))] ^= 0xff;
  fs.writeFileSync(g('dota_russian/pak02_dir.vpk'), pak);
  const r = dota.checkGame(root);
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /pak02_dir\.vpk: panorama\/a\.txt: bytes do not match the CRC/);
});

test('an item block the app changed that points at a model nothing ships is caught, and one that does ship is not', (t) => {
  const { root, g } = game(t);
  const changed = SCHEMA.replace('"models/heroes/x/x.vmdl"', '"models/heroes/x/paid.vmdl"');
  fs.writeFileSync(g('dota_russian/pak02_dir.vpk'), buildVpk([entry('scripts/items/items_game.txt', changed)]));
  let r = dota.checkGame(root);
  assert.equal(r.schema.from, 'dota_russian/pak02_dir.vpk');
  assert.equal(r.schema.checkedBlocks, 1, 'only the block the app changed is checked');
  assert.deepEqual(r.schema.missing, ['models/heroes/x/paid.vmdl_c']);
  assert.equal(r.ok, false);

  fs.writeFileSync(g('dota_russian/pak02_dir.vpk'), buildVpk([
    entry('scripts/items/items_game.txt', changed),
    entry('models/heroes/x/paid.vmdl_c', 'copied model'),
  ]));
  r = dota.checkGame(root);
  assert.deepEqual(r.schema.missing, []);
  assert.equal(r.ok, true, r.problems.join('; '));
});

test('a clean game, where Valve\'s own schema wins, has nothing to check and loads', (t) => {
  const { root } = game(t);
  const r = dota.checkGame(root);
  assert.equal(r.schema.from, 'dota/pak01_dir.vpk');
  assert.equal(r.schema.checkedBlocks, 0);
  assert.equal(r.ok, true, r.problems.join('; '));
});

/* The update reader in tools/dota-diff.mjs, on text shaped like GameTracking's own files.
 *
 * The network half is thin and not run here. What is pinned is the reading: a pak01 listing
 * parsed and diffed, the search-path lines and engine keys that would have caught build 6946's
 * rename the hour it shipped, and which files of a mod an update changed or took away.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crc32 } = require('zlib');
const { buildVpk } = require('../src/vpk.ts');

const load = () => import('../tools/dota-diff.mjs');

const PAK_6944 = [
  'models/heroes/pudge/pudge/pudge_model_vmorf.vtex_c CRC:00aaaaaaaa size:10',
  'panorama/layout/hud/versus/dota_hud_versus_scene_default.vxml_c CRC:0011111111 size:20',
  'scripts/items/items_game.txt CRC:00b9e52257 size:52330745',
  'sounds/vo/tidehunter/tide_attack_01.vsnd_c CRC:0022222222 size:30',
  '',
].join('\n');
const PAK_6952 = [
  'models/heroes/pudge/pudge/head_vmorf.vtex_c CRC:00bbbbbbbb size:11',
  'panorama/layout/hud/versus/dota_hud_versus_scene_default.vxml_c CRC:0033333333 size:21',
  'scripts/items/items_game.txt CRC:00cddb7ab1 size:52330890',
  'sounds/vo/tidehunter/tide_attack_01.vsnd_c CRC:0022222222 size:30',
  '',
].join('\r\n');

const GAMEINFO = (key) => `"GameInfo"\r\n{\r\n\tFileSystem\r\n\t{\r\n\t\tSearchPaths\r\n\t\t{\r\n\t\t\t// These are optional language paths.\r\n\t\t\t${key}\tdota_*LANGUAGE*\r\n\r\n\t\t\tGame\t\t\t\tdota\r\n\t\t\tMod\t\t\t\t\tdota\r\n\t\t}\r\n\t}\r\n}\r\n`;

test('a pak01 listing reads into path -> crc:size, either line ending', async () => {
  const { parsePakList } = await load();
  const a = parsePakList(PAK_6944);
  const b = parsePakList(PAK_6952);
  assert.equal(a.size, 4);
  assert.equal(b.size, 4);
  assert.equal(b.get('scripts/items/items_game.txt'), 'cddb7ab1:52330890');
});

test('the diff sorts files into added, changed and removed, and leaves the same file alone', async () => {
  const { parsePakList, diffLists } = await load();
  const d = diffLists(parsePakList(PAK_6944), parsePakList(PAK_6952));
  assert.deepEqual(d.added, ['models/heroes/pudge/pudge/head_vmorf.vtex_c']);
  assert.deepEqual(d.removed, ['models/heroes/pudge/pudge/pudge_model_vmorf.vtex_c']);
  assert.deepEqual(d.modified, ['panorama/layout/hud/versus/dota_hud_versus_scene_default.vxml_c', 'scripts/items/items_game.txt']);
});

test('changes are counted by folder and by hero', async () => {
  const { byFolder, byHero, heroOf, parsePakList, diffLists } = await load();
  assert.deepEqual(byFolder(['a/b/c/d.txt', 'a/b/c/e.txt', 'a/x/f.txt', 'root.txt'], 3), [['a/b/c', 2], ['(root)', 1], ['a/x', 1]]);
  assert.equal(heroOf('particles/units/heroes/hero_tidehunter/x.vpcf_c'), 'tidehunter');
  assert.equal(heroOf('models/items/pudge/arcana/a.vmdl_c'), 'pudge');
  assert.equal(heroOf('panorama/layout/hud/x.vxml_c'), null);
  const heroes = byHero(diffLists(parsePakList(PAK_6944), parsePakList(PAK_6952)));
  assert.deepEqual(heroes, [{ hero: 'pudge', added: 1, modified: 0, removed: 1 }], 'an unchanged voice line counts for nobody');
});

test('the 6946 rename shows up in the search paths, and comments do not', async () => {
  const { searchPathLines, lineDiff } = await load();
  const before = searchPathLines(GAMEINFO('Game_Language\t'));
  const after = searchPathLines(GAMEINFO('Game_AudioLanguage'));
  assert.deepEqual(before, ['Game_Language dota_*LANGUAGE*', 'Game dota', 'Mod dota']);
  assert.deepEqual(lineDiff(before, after), { gone: ['Game_Language dota_*LANGUAGE*'], came: ['Game_AudioLanguage dota_*LANGUAGE*'] });
  assert.deepEqual(lineDiff(after, searchPathLines(GAMEINFO('Game_AudioLanguage').replace('optional', 'OPTIONAL'))), { gone: [], came: [] });
  assert.deepEqual(searchPathLines(null), []);
});

test('the engine\'s search-path keys are picked out of its string dump', async () => {
  const { engineKeys, lineDiff } = await load();
  const old = 'gamebin\ngame_language\ngame_lowviolence\nGameUI\nmod\naddonroot_language\nsomething else\n';
  const now = 'gamebin\ngame_audiolanguage\ngame_lowviolence\ngame_uilanguage\nmod\naddonroot_audiolanguage\n';
  assert.deepEqual(engineKeys(old), ['addonroot_language', 'game_language', 'game_lowviolence', 'mod']);
  assert.deepEqual(lineDiff(engineKeys(old), engineKeys(now)), {
    gone: ['addonroot_language', 'game_language'],
    came: ['addonroot_audiolanguage', 'game_audiolanguage', 'game_uilanguage'],
  });
});

test('a mod is told which of its files Valve changed and which it removed', async () => {
  const { parsePakList, diffLists, modImpact } = await load();
  const d = diffLists(parsePakList(PAK_6944), parsePakList(PAK_6952));
  const mod = ['Panorama\\Layout\\HUD\\versus\\dota_hud_versus_scene_default.vxml_c', 'models/heroes/pudge/pudge/pudge_model_vmorf.vtex_c', 'models/mine/own.vmdl_c'];
  assert.deepEqual(modImpact(mod, d), {
    modified: ['panorama/layout/hud/versus/dota_hud_versus_scene_default.vxml_c'],
    removed: ['models/heroes/pudge/pudge/pudge_model_vmorf.vtex_c'],
  });
});

test('mod packs are found in folders, without data volumes or Valve\'s own pak01', async (t) => {
  const { vpksIn } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-dotadiff-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = Buffer.from('x');
  const vpk = buildVpk([{ ext: 'txt', folder: 'a', name: 'b', data, preload: Buffer.alloc(0), crc: crc32(data) >>> 0 }]);
  for (const n of ['pak01_dir.vpk', 'pak01_000.vpk', 'pak30_dir.vpk', 'readme.txt']) fs.writeFileSync(path.join(dir, n), vpk);
  assert.deepEqual(vpksIn([dir]), [path.join(dir, 'pak30_dir.vpk')]);
  assert.deepEqual(vpksIn([path.join(dir, 'pak01_dir.vpk')]), [path.join(dir, 'pak01_dir.vpk')], 'named directly, it is read');
});

test('the build number comes out of steam.inf', async () => {
  const { buildOf } = await load();
  assert.equal(buildOf('ClientVersion=6952\r\nServerVersion=6952\r\n'), 6952);
  assert.equal(buildOf(null), null);
});

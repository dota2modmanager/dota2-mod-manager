/* The Dota update watcher (tools/dota-watch.mjs), on a report shaped like build 6946's.
 *
 * The part that talks to GitHub and Discord is thin and not run here. What is pinned: the issue
 * remembers where it stopped, the catalog's file lists are read back and held against the diff,
 * the comment leads with what the app's patch depends on, and Discord hears only about that.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../tools/dota-watch.mjs');

const SHA = 'a6e0baf1d966'.padEnd(40, '0');

/** A report as tools/dota-diff.mjs compare() returns it, trimmed to what the watcher reads. */
const report = ({ rename = true, branch = false } = {}) => ({
  from: { build: 6944, date: '2026-10-05T20:33:26Z' },
  to: { build: 6952, date: '2026-10-07T17:50:35Z' },
  compare: 'https://github.com/SteamTracking/GameTracking-Dota2/compare/36e1e3d...a6e0baf',
  watch: {
    searchPaths: rename ? { gone: ['Game_Language dota_*LANGUAGE*'], came: ['Game_AudioLanguage dota_*LANGUAGE*'] } : { gone: [], came: [] },
    engineKeys: rename ? { gone: ['game_language'], came: ['game_audiolanguage', 'game_uilanguage'] } : { gone: [], came: [] },
    branchChanged: branch,
    schema: { from: 'b9e52257:52330745', to: 'cddb7ab1:52330890' },
  },
  pak: {
    counts: { added: 1, modified: 2, removed: 1 },
    added: [['models/heroes/pudge/pudge', 1]], modified: [['panorama/layout/hud', 2]], removed: [['models/heroes/pudge/pudge', 1]],
    heroes: [{ hero: 'pudge', added: 1, modified: 0, removed: 1 }],
  },
  diff: {
    added: ['models/heroes/pudge/pudge/head_vmorf.vtex_c'],
    modified: ['panorama/layout/hud/dota_hud.vxml_c', 'panorama/layout/hud/versus/dota_hud_versus_scene_default.vxml_c'],
    removed: ['models/heroes/pudge/pudge/pudge_model_vmorf.vtex_c'],
  },
});

const MOD_PATHS = {
  count: 3,
  mods: {
    'heroes/Pudge Arcana': { name: 'Pudge Arcana', categoryId: 'heroes', styleLabel: null, dirs: { 'models/heroes/pudge/pudge': ['pudge_model_vmorf.vtex_c', 'head_vmorf.vtex_c', 'pudge.vmdl_c'] } },
    'hud/Golden HUD [Dire]': { name: 'Golden HUD', categoryId: 'hud', styleLabel: 'Dire', dirs: { 'panorama/layout/hud': ['dota_hud.vxml_c'], 'panorama/layout/hud/versus': ['dota_hud_versus_scene_default.vxml_c'] } },
    'trees/Pines': { name: 'Pines', categoryId: 'trees', styleLabel: null, dirs: { 'models/props_tree': ['pine.vmdl_c'] } },
  },
};

test('the issue body says where it stopped, and reads it back', async () => {
  const { issueBody, lastSeen } = await load();
  const body = issueBody(6952, SHA);
  assert.deepEqual(lastSeen(body), { build: 6952, sha: SHA });
  assert.equal(lastSeen('a body somebody edited by hand'), null);
  assert.equal(lastSeen(null), null);
});

test('the catalog\'s file lists come back as paths, and the mods the update reached are counted', async () => {
  const { readCatalogPaths, catalogImpact } = await load();
  const catalog = readCatalogPaths(MOD_PATHS);
  assert.deepEqual(catalog.get('trees/Pines').paths, ['models/props_tree/pine.vmdl_c']);
  assert.deepEqual(catalogImpact(catalog, report().diff), [
    { key: 'heroes/Pudge Arcana', name: 'Pudge Arcana', categoryId: 'heroes', styleLabel: null, changed: 1, removed: 1 },
    { key: 'hud/Golden HUD [Dire]', name: 'Golden HUD', categoryId: 'hud', styleLabel: 'Dire', changed: 2, removed: 0 },
  ], 'a file Valve ships for the first time under a mod\'s path counts as changed; Pines is untouched');
  assert.deepEqual(readCatalogPaths(null).size, 0);
});

test('the comment leads with the search paths, and names the catalog mods', async () => {
  const { renderMarkdown, readCatalogPaths, catalogImpact } = await load();
  const r = report();
  const md = renderMarkdown(r, catalogImpact(readCatalogPaths(MOD_PATHS), r.diff));
  assert.ok(md.indexOf('search paths in `gameinfo.gi` changed') < md.indexOf('### pak01'), 'what the app depends on comes first');
  assert.match(md, /```diff\n- Game_Language dota_\*LANGUAGE\*\n\+ Game_AudioLanguage dota_\*LANGUAGE\*\n```/);
  assert.match(md, /`-game_language` `\+game_audiolanguage` `\+game_uilanguage`/);
  assert.match(md, /\| Golden HUD \(Dire\) \| hud \| 2 \| 0 \|/);
  assert.match(md, /Catalog mods that replace files this update changed or removed: 2/);
});

test('without the catalog\'s lists the comment says so instead of claiming no mod was reached', async () => {
  const { renderMarkdown } = await load();
  const md = renderMarkdown(report({ rename: false }), null);
  assert.match(md, /were not available/);
  assert.match(md, /Search paths in `gameinfo.gi`: unchanged/);
});

test('Discord hears only about what the patch is built from', async () => {
  const { critical, discordText } = await load();
  assert.equal(critical(report()), true);
  assert.equal(critical(report({ rename: false })), false, 'new skins and a bigger item table are the issue\'s business');
  assert.equal(critical(report({ rename: false, branch: true })), true);
  assert.match(discordText(report(), 'https://example.test/issues/1#c'), /^Dota 6952 changed what the mod patch is built from: gameinfo\.gi search paths \(-Game_Language dota_\*LANGUAGE\*; \+Game_AudioLanguage dota_\*LANGUAGE\*\), engine search-path keys\. https:/);
});

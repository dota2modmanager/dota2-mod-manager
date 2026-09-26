/* The settings store: a JSON file, and the defaults every unset key falls back to.
 *
 * Small enough to look obviously right, and load-bearing enough that being wrong is invisible
 * until somebody's mods are in the wrong folder. The cases that matter are all about the merge
 * on read: a settings file written by an older version is missing keys that were added since,
 * and what the app does with those decides whether an upgrade is quiet or destructive.
 *
 * The defaults themselves are checked one by one because several of them are decisions with a
 * comment above them in src/settings.js explaining what a different value would cost -
 * schemaPatch starting off, langSuffix starting russian, lastSeenVersion starting null. A
 * default that drifts is a decision undone by accident.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Settings } = require('../src/settings.js');

function store(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-set-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  if (contents !== undefined) fs.writeFileSync(file, contents);
  return { s: new Settings(dir), dir, file };
}

test('a fresh install starts on the defaults, and they are the documented ones', (t) => {
  const { s } = store(t);
  assert.equal(s.get('dotaGamePath'), null);
  assert.equal(s.get('langSuffix'), 'russian', 'English has no folder of its own and borrows this one');
  assert.equal(s.get('uiLang'), 'en');
  assert.equal(s.get('uiScale'), 1);
  assert.equal(s.get('theme'), 'ursa');
  assert.equal(s.get('schemaPatch'), false, 'safe until the user agrees to it once');
  assert.equal(s.get('discordPresence'), true);
  assert.equal(s.get('langPromptSeen'), false);
  assert.equal(s.get('toolsPromptSeen'), false);
  assert.equal(s.get('lastSeenVersion'), null, 'so a hand-installed version shows no what-is-new popup');
  assert.deepEqual(s.get('favorites'), []);
  assert.equal(s.get('panels'), null);
  assert.equal(s.get('account'), null);
  assert.equal(s.get('showAdult'), null, 'adult mods stay hidden until the user answers');
});

test('nothing is written until something is set', (t) => {
  const { s, file } = store(t);
  assert.equal(fs.existsSync(file), false, 'reading defaults does not create a file');
  s.set('uiLang', 'ru');
  assert.equal(fs.existsSync(file), true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf-8')).uiLang, 'ru');
});

test('a value survives a second Settings over the same folder', (t) => {
  const { s, dir } = store(t);
  s.set('dotaGamePath', 'C:/games/dota 2 beta/game');
  s.set('uiScale', 1.25);
  s.set('favorites', ['heroes|Crystal Maiden']);

  const again = new Settings(dir);
  assert.equal(again.get('dotaGamePath'), 'C:/games/dota 2 beta/game');
  assert.equal(again.get('uiScale'), 1.25);
  assert.deepEqual(again.get('favorites'), ['heroes|Crystal Maiden']);
});

test('a file from an older version keeps its values and gains the new defaults', (t) => {
  /* This is the upgrade path, and getting it backwards in either direction is expensive: drop
   * the stored values and somebody's game path and starred mods are gone, drop the defaults and
   * every key added since is undefined for everybody who did not install fresh. */
  const { s } = store(t, JSON.stringify({ dotaGamePath: 'D:/dota/game', uiLang: 'ru' }));
  assert.equal(s.get('dotaGamePath'), 'D:/dota/game', 'kept');
  assert.equal(s.get('uiLang'), 'ru', 'kept');
  assert.equal(s.get('schemaPatch'), false, 'a key added later comes from the defaults');
  assert.equal(s.get('theme'), 'ursa');
  assert.equal(s.get('langPromptSeen'), false, 'so an upgrading user sees the picker once too');
});

test('a file with a byte order mark in front keeps its values', (t) => {
  /* Notepad and Windows PowerShell 5 write one. JSON.parse refused it, every value fell back to
   * its default, and with the game path gone the app went looking for Dota again: on 2026-09-26 a
   * sandbox run found the real install that way and wrote into it. */
  const { s } = store(t, `\uFEFF${JSON.stringify({ dotaGamePath: 'D:/sandbox/game', uiLang: 'ru' })}`);
  assert.equal(s.get('dotaGamePath'), 'D:/sandbox/game');
  assert.equal(s.get('uiLang'), 'ru');
});

test('a stored false or zero is kept rather than treated as missing', (t) => {
  // the merge is a spread, so anything falsy has to survive it: `discordPresence: false` and
  // `uiScale: 0.7` are choices, not gaps
  const { s } = store(t, JSON.stringify({ discordPresence: false, uiScale: 0.7, langPromptSeen: true }));
  assert.equal(s.get('discordPresence'), false);
  assert.equal(s.get('uiScale'), 0.7);
  assert.equal(s.get('langPromptSeen'), true);
});

test('an unreadable settings file falls back to the defaults instead of throwing', (t) => {
  const { s } = store(t, '{ half a file');
  assert.equal(s.get('uiLang'), 'en');
  assert.equal(s.get('langSuffix'), 'russian');
  assert.equal(s.get('schemaPatch'), false, 'and the safe value is what a broken file lands on');
});

test('a settings file holding something that is not an object does not poison the store', (t) => {
  for (const junk of ['null', '"a string"', '42', '[]']) {
    const { s } = store(t, junk);
    assert.equal(s.get('langSuffix'), 'russian', `on ${junk}`);
    assert.equal(s.get('uiScale'), 1, `on ${junk}`);
  }
});

test('all() hands back a copy, so nobody edits the store by holding its object', (t) => {
  /* The renderer caches whatever settings:get returns. If that were the live object, a screen
   * mutating its own copy would silently change what the main process thinks is stored. */
  const { s } = store(t);
  const snapshot = s.all();
  snapshot.uiLang = 'ru';
  snapshot.favorites.push('tampered');
  assert.equal(s.get('uiLang'), 'en', 'the store is unchanged');
  assert.deepEqual(s.all().favorites, ['tampered'], 'arrays are shared, which is worth knowing');
});

test('an unknown key reads as undefined and can be set like any other', (t) => {
  const { s, dir } = store(t);
  assert.equal(s.get('somethingNobodyDefined'), undefined);
  s.set('somethingNobodyDefined', 7);
  assert.equal(new Settings(dir).get('somethingNobodyDefined'), 7);
});

test('the folder is created if it is not there yet', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-set-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const nested = path.join(dir, 'does', 'not', 'exist');
  const s = new Settings(nested);
  s.set('uiLang', 'ru');
  assert.equal(fs.existsSync(path.join(nested, 'settings.json')), true);
});

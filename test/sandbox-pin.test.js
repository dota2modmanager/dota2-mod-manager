/* `npm run start:sandbox` pins the sandbox's settings to the sandbox game before the app starts
 * (tools/sandbox-pin.js).
 *
 * The app re-detects the game when the saved path is not an install, and detection finds the
 * real one. On 2026-10-03 a sandbox run started with settings naming a sandbox inside a copy of
 * the repository that no longer existed, and the app moved itself onto the real game and wrote
 * into its language folder. These hold the three answers: a stale path is replaced, a sandbox
 * that was never built refuses the run, and missing settings refuse it too.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { pinGamePath } = require('../tools/sandbox-pin.js');

function sandbox(t, { game = true, settings = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-pin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gameDir = path.join(root, 'steamapps', 'common', 'dota 2 beta', 'game');
  if (game) {
    fs.mkdirSync(path.join(gameDir, 'dota'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'dota', 'pak01_dir.vpk'), 'the sandbox game');
  }
  const userData = path.join(root, 'userdata');
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, 'settings.json');
  if (settings) fs.writeFileSync(file, JSON.stringify(settings));
  return { gameDir, userData, read: () => JSON.parse(fs.readFileSync(file, 'utf8')), file };
}

test('a sandbox whose settings name a folder that is gone is pinned back to its own game', (t) => {
  const gone = path.join(os.tmpdir(), 'dm-c', 'sandbox', 'steamapps', 'common', 'dota 2 beta', 'game');
  const s = sandbox(t, { settings: { dotaGamePath: gone, uiLang: 'ru' } });
  assert.equal(pinGamePath(s.userData, s.gameDir), null);
  assert.equal(s.read().dotaGamePath, s.gameDir);
  assert.equal(s.read().uiLang, 'ru', 'the rest of the settings stay as they were');
});

test('settings already on the sandbox game are left alone', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(s.file, JSON.stringify({ dotaGamePath: s.gameDir }));
  const before = fs.statSync(s.file).mtimeMs;
  assert.equal(pinGamePath(s.userData, s.gameDir), null);
  assert.equal(fs.statSync(s.file).mtimeMs, before, 'not rewritten');
});

test('a sandbox seeded before a version bump does not open on "What\'s new"', (t) => {
  // a scripted run never clicks the window away, so it covered every screenshot after a bump
  const s = sandbox(t);
  fs.writeFileSync(s.file, JSON.stringify({ dotaGamePath: s.gameDir, lastSeenVersion: '2.7.1' }));
  assert.equal(pinGamePath(s.userData, s.gameDir, () => {}, '2.8.0'), null);
  assert.equal(s.read().lastSeenVersion, '2.8.0');
  const before = fs.statSync(s.file).mtimeMs;
  assert.equal(pinGamePath(s.userData, s.gameDir, () => {}, '2.8.0'), null);
  assert.equal(fs.statSync(s.file).mtimeMs, before, 'already current, not rewritten');
});

test('a sandbox with no game in it refuses the run instead of letting the app look for one', (t) => {
  const s = sandbox(t, { game: false, settings: { dotaGamePath: null } });
  assert.match(pinGamePath(s.userData, s.gameDir), /sandbox:seed/);
  assert.equal(s.read().dotaGamePath, null, 'nothing was written');
});

test('a sandbox with no settings refuses the run', (t) => {
  const s = sandbox(t, { settings: null });
  assert.match(pinGamePath(s.userData, s.gameDir), /sandbox:seed/);
  assert.equal(fs.existsSync(s.file), false);
});

// What counts as a Dota install.
//
// Written after a real one (2026-08-14). A user moved his Steam library from C to F. Steam
// left the empty folder tree behind on C, as it does, and the app's check was "is there a
// folder called dota in there" - which there was. So it kept installing into the leftovers:
// forty-three mods reported as installed, nothing in the game, and the library still listing
// them all. The check now asks for Valve's own content pak, the one file that cannot be
// present unless the game is.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateGamePath, findDotaGamePath } from '../src/steam.ts';
import installerJs from '../src/installer.js';
const { Installer } = installerJs;

function tmpDir(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-gamepath-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A game folder as Steam leaves it behind after the library moves: the tree, none of it. */
function movedAway(root: string): string {
  const game = path.join(root, 'steamapps', 'common', 'dota 2 beta', 'game');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  return game;
}

/** A real one: the tree plus the content pak. */
function realInstall(root: string): string {
  const game = movedAway(root);
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), 'not really a vpk, but it is there');
  return game;
}

test('the leftovers of a moved library are not an install', (t) => {
  const dir = tmpDir(t);
  assert.equal(validateGamePath(movedAway(dir)), false);
});

test('a folder with the content pak in it is', (t) => {
  const dir = tmpDir(t);
  assert.equal(validateGamePath(realInstall(dir)), true);
});

// One marker can be absent from a working install for a moment, mid-download or while Steam
// verifies, so either answers for the other.
test('the executable alone is enough, and so is the pak alone', (t) => {
  const dir = tmpDir(t);
  const game = movedAway(dir);
  assert.equal(validateGamePath(game), false, 'neither: not an install');

  fs.mkdirSync(path.join(game, 'bin', 'win64'), { recursive: true });
  fs.writeFileSync(path.join(game, 'bin', 'win64', 'dota2.exe'), 'exe');
  assert.equal(validateGamePath(game), true, 'the executable on its own');

  fs.rmSync(path.join(game, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), 'pak');
  assert.equal(validateGamePath(game), true, 'the pak on its own');
});

// The voice pack is not the game. Plenty of installs never download one, and testing for it
// would call a working setup broken.
test('a missing voice pack does not make an install invalid', (t) => {
  const dir = tmpDir(t);
  const game = realInstall(dir);
  fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota_russian', 'pak12_dir.vpk'), 'somebody mod');
  assert.equal(fs.existsSync(path.join(game, 'dota_russian', 'pak01_dir.vpk')), false, 'no voice pack');
  assert.equal(validateGamePath(game), true);
});

// Same question on Linux, different file: the game ships as bin/linuxsteamrt64/dota2 there,
// which is the name src/patcher.ts already patches around.
test('the Linux executable counts as an install too', (t) => {
  const dir = tmpDir(t);
  const game = movedAway(dir);
  fs.mkdirSync(path.join(game, 'bin', 'linuxsteamrt64'), { recursive: true });
  fs.writeFileSync(path.join(game, 'bin', 'linuxsteamrt64', 'dota2'), 'elf');
  assert.equal(validateGamePath(game), true);
});

// Discovery on Linux, where there is no registry to ask. XDG_DATA_HOME is the one root that
// can be pointed at a temporary folder, so it is the one the test drives.
test('a library under XDG_DATA_HOME is found', { skip: process.platform === 'win32' }, async (t) => {
  const dir = tmpDir(t);
  const was = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  t.after(() => { if (was === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = was; });

  const game = path.join(dir, 'Steam', 'steamapps', 'common', 'dota 2 beta', 'game');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), 'pak');

  assert.equal(await findDotaGamePath(), game);
});

// Steam spelled it SteamApps for years, and a case-sensitive filesystem does not forgive the
// difference. An install from that era still has to be found.
test('the old SteamApps spelling is found as well', { skip: process.platform === 'win32' }, async (t) => {
  const dir = tmpDir(t);
  const was = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = dir;
  t.after(() => { if (was === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = was; });

  const game = path.join(dir, 'Steam', 'SteamApps', 'common', 'dota 2 beta', 'game');
  fs.mkdirSync(path.join(game, 'bin', 'linuxsteamrt64'), { recursive: true });
  fs.writeFileSync(path.join(game, 'bin', 'linuxsteamrt64', 'dota2'), 'elf');

  assert.equal(await findDotaGamePath(), game);
});

test('nothing, a missing folder and a file all fail rather than throw', (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'a-file');
  fs.writeFileSync(file, 'x');
  for (const bad of [null, undefined, '', path.join(dir, 'nope'), file]) {
    assert.equal(validateGamePath(bad), false, `refused: ${JSON.stringify(bad)}`);
  }
});

// The gate that matters: mkdir is recursive, so before this the installer answered a wrong
// path by building the whole tree and writing into it.
test('the installer refuses to make a mods folder where the game is not', (t) => {
  const dir = tmpDir(t);
  const game = movedAway(dir);
  const inst = new Installer({
    userDataDir: tmpDir(t),
    getGamePath: () => game,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });

  assert.throws(() => inst.ensureLangFolder(), /Dota 2/);
  assert.equal(fs.existsSync(path.join(game, 'dota_russian')), false, 'and it created nothing');
});

// "Приложение вообще не должно скачивать моды" - the check has to come before the download,
// not at the write, or a mod with nowhere to go still costs a 300 MB download first.
test('nothing is downloaded when there is nowhere to install it', async (t) => {
  const dir = tmpDir(t);
  const inst = new Installer({
    userDataDir: tmpDir(t),
    getGamePath: () => movedAway(dir),
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });
  let asked = false;
  inst.download = async () => { asked = true; return 'never'; };

  await assert.rejects(
    () => inst.install({ categoryId: 'heroes', modName: 'Some Mod', fileRef: 'mod.vpk' }),
    /Dota 2/,
  );
  assert.equal(asked, false, 'the download was never started');
});

test('with a real install it makes the folder as before', (t) => {
  const dir = tmpDir(t);
  const game = realInstall(dir);
  const inst = new Installer({
    userDataDir: tmpDir(t),
    getGamePath: () => game,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });

  const made = inst.ensureLangFolder();
  assert.equal(made, path.join(game, 'dota_russian'));
  assert.ok(fs.existsSync(path.join(made, 'gameinfo.gi')), 'with the layer definition in it');
});

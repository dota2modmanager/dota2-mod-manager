/* Finding Dota, and deciding a folder really is Dota.
 *
 * validateGamePath is the gate: nothing is written into a folder that does not pass it, and a
 * false yes means the app starts putting VPK files somewhere that is not a game. It also has to
 * say yes to installs it has never seen - a library on a second drive, a Linux install, a game
 * folder whose executable was moved by an anti-cheat - so it accepts three different pieces of
 * evidence and only needs one.
 *
 * parseLibraryFolders reads a file Valve writes in a format Valve has changed more than once.
 * When it is wrong the app looks for the game on the wrong drive, which is hard to notice and
 * easy to pin down with a fixture.
 *
 * findDotaGamePath is deliberately not exercised here: it reads the registry and the real
 * Steam of whoever is running the tests, and a test that does that passes or fails depending on
 * the machine. gamelang.test.js had exactly that problem and had to be isolated after it broke
 * on a developer's own launch options.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateGamePath, parseLibraryFolders, steamappsDir } from '../src/steam.ts';

/** A folder holding one file, at a path given as segments. */
function tree(t: TestContext, ...relParts: string[][]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-steam-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const rel of relParts) {
    const full = path.join(dir, ...rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
  }
  return dir;
}

// ---------- is this folder a Dota install ----------

test('the game archive alone is enough, and it is what a moved install still has', (t) => {
  const game = tree(t, ['dota', 'pak01_dir.vpk']);
  assert.equal(validateGamePath(game), true);
});

test('the Windows executable alone is enough', (t) => {
  const game = tree(t, ['bin', 'win64', 'dota2.exe']);
  assert.equal(validateGamePath(game), true);
});

test('the Linux executable alone is enough', (t) => {
  const game = tree(t, ['bin', 'linuxsteamrt64', 'dota2']);
  assert.equal(validateGamePath(game), true);
});

test('a folder with none of the three is not a game, however plausible it looks', (t) => {
  const notGame = tree(t, ['dota', 'readme.txt'], ['bin', 'win64', 'other.exe']);
  assert.equal(validateGamePath(notGame), false);
});

test('an empty folder, a missing one, and no path at all are all no', (t) => {
  const empty = tree(t);
  assert.equal(validateGamePath(empty), false);
  assert.equal(validateGamePath(path.join(empty, 'nowhere')), false);
  assert.equal(validateGamePath(''), false);
  assert.equal(validateGamePath(null), false);
  assert.equal(validateGamePath(undefined), false);
});

test('a path that is a file rather than a folder is no, not a throw', (t) => {
  const dir = tree(t, ['a-file']);
  assert.equal(validateGamePath(path.join(dir, 'a-file')), false);
});

// ---------- reading Steam's list of library folders ----------

test('every library in the file comes back, in the order Valve wrote them', () => {
  const vdf = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"label"\t\t""
\t}
\t"1"
\t{
\t\t"path"\t\t"D:\\\\SteamLibrary"
\t}
}`;
  assert.deepEqual(parseLibraryFolders(vdf), [
    'C:\\Program Files (x86)\\Steam',
    'D:\\SteamLibrary',
  ], 'and the doubled backslashes Valve escapes are undoubled');
});

test('a Linux libraryfolders file has no escaping to undo', () => {
  const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"/home/me/.local/share/Steam"\n\t}\n}';
  assert.deepEqual(parseLibraryFolders(vdf), ['/home/me/.local/share/Steam']);
});

test('the old flat format still reads, because old installs still have it', () => {
  // Valve used to write "1" "D:\\SteamLibrary" with no block around it. Machines that have
  // been upgraded rather than reinstalled can still carry the newer file with either shape.
  const vdf = '"LibraryFolders"\n{\n\t"path"\t\t"E:\\\\Games\\\\Steam"\n}';
  assert.deepEqual(parseLibraryFolders(vdf), ['E:\\Games\\Steam']);
});

test('a file with no libraries, and junk, both come back empty rather than throwing', () => {
  assert.deepEqual(parseLibraryFolders('"libraryfolders"\n{\n}'), []);
  assert.deepEqual(parseLibraryFolders(''), []);
  assert.deepEqual(parseLibraryFolders('not a vdf at all'), []);
  assert.deepEqual(parseLibraryFolders('"path" "unclosed'), [], 'a truncated file names nothing');
});

// ---------- steamapps, which is not always spelled the same ----------

test('whichever spelling is on disk is the one used', (t) => {
  const lower = tree(t, ['steamapps', 'x']);
  assert.equal(steamappsDir(lower), path.join(lower, 'steamapps'));

  const upper = tree(t, ['SteamApps', 'x']);
  // On Windows the filesystem is case-insensitive, so "steamapps" is found first and both
  // answers point at the same directory; on Linux the capital spelling is a different folder
  // and has to be found on its own. Either way the answer has to exist.
  assert.equal(fs.existsSync(steamappsDir(upper)), true);
});

test('with neither on disk it still answers, so the caller can say what is missing', (t) => {
  const bare = tree(t);
  assert.equal(steamappsDir(bare), path.join(bare, 'steamapps'));
});

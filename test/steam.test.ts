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
 * findDotaGamePath itself is not run here: it reads the registry and the real Steam of whoever
 * runs the tests, and a test that does that passes or fails depending on the machine.
 * gamelang.test.js had exactly that problem and had to be isolated after it broke on a
 * developer's own launch options. Everything behind it takes what it reads as arguments - what
 * `reg` printed, the home folder, the candidate roots, the libraries - and is tested below
 * against folders made here.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  validateGamePath, parseLibraryFolders, steamappsDir, regValue, linuxSteamRoots, pickSteamRoot, fallbackLibraries, findDotaIn,
} from '../src/steam.ts';

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

// ---------- where Steam is ----------

test('the registry answer is read off the line reg prints, and no answer is null', () => {
  const printed = '\r\nHKEY_CURRENT_USER\\SOFTWARE\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n';
  assert.equal(regValue(printed), 'c:/program files (x86)/steam');
  assert.equal(regValue('ERROR: The system was unable to find the specified registry key or value.'), null);
});

test('on Linux the symlink Steam keeps is tried first, then the real folder, then the flatpak', () => {
  const home = path.join(path.sep, 'home', 'u');
  assert.deepEqual(linuxSteamRoots(home, {}), [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.steam', 'root'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
  ]);
  // XDG_DATA_HOME moves the real folder, and only that one
  assert.equal(linuxSteamRoots(home, { XDG_DATA_HOME: path.join(path.sep, 'data') })[2], path.join(path.sep, 'data', 'Steam'));
});

test('the first root that is there wins, a missing one is passed over, and a POSIX path is left as it is', (t) => {
  const steam = tree(t, ['steam.exe']);
  assert.equal(pickSteamRoot([null, path.join(steam, 'gone'), steam], false), steam);
  assert.equal(pickSteamRoot([null, path.join(steam, 'gone')], false), null);
  // the registry writes forward slashes; on Windows they become the separator the rest expects
  const forward = steam.replace(/\\/g, '/');
  assert.equal(pickSteamRoot([forward], true), forward.replace(/\//g, '\\'));
});

test('without an answer from Steam the usual places are tried, on every drive or under home', () => {
  const win = fallbackLibraries(true, 'C:\\Users\\u');
  for (const lib of ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary', 'H:\\Games\\Steam']) assert.ok(win.includes(lib), lib);
  const home = path.join(path.sep, 'home', 'u');
  const linux = fallbackLibraries(false, home);
  assert.equal(linux[0], path.join(home, '.steam', 'steam'));
  assert.equal(linux[linux.length - 1], path.join(home, 'Games', 'SteamLibrary'));
});

// ---------- where Dota is ----------

/** A Steam library holding a real install: the base content pak is what makes it one. */
const installIn = (lib: string) => {
  const pak = path.join(lib, 'steamapps', 'common', 'dota 2 beta', 'game', 'dota', 'pak01_dir.vpk');
  fs.mkdirSync(path.dirname(pak), { recursive: true });
  fs.writeFileSync(pak, '');
  return path.dirname(path.dirname(pak));
};

/** A libraryfolders.vdf naming these libraries, its backslashes doubled the way Steam writes them. */
const vdf = (...libs: string[]) => ['"libraryfolders"', '{',
  ...libs.flatMap((l, i) => [`\t"${i}"`, '\t{', `\t\t"path"\t\t"${l.replace(/\\/g, '\\\\')}"`, '\t}']), '}', ''].join('\n');

test('the library Steam names is searched, and the empty tree a moved library leaves behind is not a hit', (t) => {
  const root = tree(t);
  const steam = path.join(root, 'Steam');
  const second = path.join(root, 'F-drive', 'SteamLibrary');
  // Steam leaves the old tree on C when a library moves; it has the folders and none of the files
  fs.mkdirSync(path.join(steam, 'steamapps', 'common', 'dota 2 beta', 'game', 'dota'), { recursive: true });
  const game = installIn(second);
  fs.writeFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), vdf(steam, second));
  assert.equal(findDotaIn(steam, []), game);
});

test('with no Steam, or a libraries file that cannot be read, the fallbacks still find the game', (t) => {
  const root = tree(t);
  const lib = path.join(root, 'SteamLibrary');
  const game = installIn(lib);
  assert.equal(findDotaIn(null, [path.join(root, 'nowhere'), lib]), game);

  const steam = path.join(root, 'Steam');
  fs.mkdirSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), { recursive: true }); // a folder, not a file
  assert.equal(findDotaIn(steam, [lib]), game);
  assert.equal(findDotaIn(null, []), null);
  assert.equal(findDotaIn(null, [path.join(root, 'nowhere')]), null);
});

test('a library named twice in different case is looked at once', (t) => {
  const root = tree(t);
  const lib = path.join(root, 'Lib');
  const looked: string[] = [];
  const real = fs.existsSync;
  t.after(() => { (fs as { existsSync: typeof fs.existsSync }).existsSync = real; });
  (fs as { existsSync: typeof fs.existsSync }).existsSync = ((f: fs.PathLike) => {
    if (String(f).toLowerCase().endsWith(path.join('dota', 'pak01_dir.vpk'))) looked.push(String(f).toLowerCase());
    return real(f);
  }) as typeof fs.existsSync;
  findDotaIn(null, [lib, lib.toUpperCase(), lib.toLowerCase()]);
  assert.equal(looked.length, 1);
});

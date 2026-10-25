/* Wine for resourcecompiler.exe on Linux (src/wine.ts): which Wine is found, how a path is handed
 * to a Windows program, and the app's own prefix, made once and never trusted half made.
 *
 * wineboot itself is not run here: a fake stands in for it and does what it leaves on disk. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ensurePrefix, findWine, pathWines, prefixReady, protonWines, wineEnv, winePath, type RunProcess } from '../src/wine.ts';

const posix = process.platform !== 'win32';

function tmp(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-wine-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function touch(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  return file;
}

/** wineboot as far as the disk can tell: it makes system.reg in the prefix it was given. */
function fakeWineboot(calls: string[][] = [], code = 0): RunProcess {
  return async (exe, args, { env }) => {
    calls.push([exe, ...args]);
    if (code === 0) touch(path.join(String(env?.WINEPREFIX), 'system.reg'));
    return { code, out: code ? 'wine: could not load kernel32.dll\n' : '' };
  };
}

test('a Linux path goes to a Windows program through the Z: drive', { skip: !posix }, () => {
  assert.equal(winePath('/home/me/dota 2 beta/content/a.vmdl'), 'Z:\\home\\me\\dota 2 beta\\content\\a.vmdl');
});

test('the env is quiet, 64-bit, offers no Mono or Gecko, and keeps the rest of the caller\'s', () => {
  const env = wineEnv('/p', { PATH: '/usr/bin', WINEDEBUG: '+all' });
  assert.equal(env.WINEPREFIX, '/p');
  assert.equal(env.WINEARCH, 'win64');
  assert.equal(env.WINEDEBUG, '-all');
  assert.equal(env.WINEDLLOVERRIDES, 'mscoree,mshtml=');
  assert.equal(env.PATH, '/usr/bin');
});

test('the system\'s Wine is found on PATH before any Proton', { skip: !posix }, (t) => {
  const dir = tmp(t);
  const bin = path.join(dir, 'bin');
  const wine = touch(path.join(bin, 'wine'));
  touch(path.join(dir, '.steam', 'steam', 'steamapps', 'common', 'Proton 9.0', 'files', 'bin', 'wine'));
  assert.deepEqual(pathWines({ PATH: `/nowhere${path.delimiter}${bin}` }), [wine]);
  assert.equal(findWine({ env: { PATH: bin }, home: dir }), wine);
});

test('with no Wine on PATH, a Proton of any Steam library is used, the newest first', { skip: !posix }, (t) => {
  const home = tmp(t);
  const root = path.join(home, '.steam', 'steam');
  const lib = path.join(home, 'games');
  const common = (l: string) => path.join(l, 'steamapps', 'common');
  fs.mkdirSync(path.join(root, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n "0" { "path" "${root}" }\n "1" { "path" "${lib}" }\n}\n`);
  const old = touch(path.join(common(root), 'Proton 8.0', 'dist', 'bin', 'wine'));
  const newer = touch(path.join(common(lib), 'Proton 9.0', 'files', 'bin', 'wine'));
  touch(path.join(common(lib), 'Not Proton', 'files', 'bin', 'wine'));
  assert.deepEqual(protonWines([root]), [old, newer]);
  assert.equal(findWine({ env: { PATH: '' }, home }), old, 'the first library Steam names comes first');
  assert.equal(findWine({ env: { PATH: '' }, home: tmp(t) }), null);
});

test('the prefix is made once, and marked only after wineboot made it', async (t) => {
  const prefix = path.join(tmp(t), 'wine');
  const calls: string[][] = [];
  await ensurePrefix(prefix, '/usr/bin/wine', fakeWineboot(calls));
  assert.deepEqual(calls, [['/usr/bin/wine', 'wineboot', '--init']]);
  assert.ok(prefixReady(prefix));
  await ensurePrefix(prefix, '/usr/bin/wine', fakeWineboot(calls));
  assert.equal(calls.length, 1, 'a made prefix is not made again');
});

test('a prefix left half made is thrown away and made again', async (t) => {
  const prefix = path.join(tmp(t), 'wine');
  touch(path.join(prefix, 'system.reg'));
  touch(path.join(prefix, 'drive_c', 'leftover'));
  assert.equal(prefixReady(prefix), false, 'no marker: not ready');
  await ensurePrefix(prefix, 'wine', fakeWineboot());
  assert.ok(prefixReady(prefix));
  assert.equal(fs.existsSync(path.join(prefix, 'drive_c', 'leftover')), false);
});

test('a wineboot that fails says what Wine said, and leaves no marker', async (t) => {
  const prefix = path.join(tmp(t), 'wine');
  await assert.rejects(ensurePrefix(prefix, 'wine', fakeWineboot([], 1)), /wineboot exited with 1: wine: could not load kernel32\.dll/);
  assert.equal(prefixReady(prefix), false);
});

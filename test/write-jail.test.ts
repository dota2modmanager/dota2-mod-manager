/* A sandbox run that cannot write outside the sandbox (src/write-jail.ts).
 *
 * Each test puts the jail up over one folder, keeps a control folder beside it with a file in it,
 * and tries every way out it can think of: a plain absolute path, "..", a junction or symlink
 * inside the jail pointing out, both ends of a rename, a copy's destination, a folder made, a file
 * opened for writing, the callback, promise and stream forms. Every one has to be refused, and the
 * control folder has to be byte for byte what it was. Then the case that started it, 2026-10-03:
 * the installer pointed at a game outside the sandbox, as a wrong path or a broken check would
 * point it, installs nothing there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { insideJail, installWriteJail, jailFromArgv, jailRefusals, jailRoots, jailThisRun } from '../src/write-jail.ts';
import { validateGamePath } from '../src/steam.ts';
import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';

/** Every file under a folder with its bytes. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = path.relative(dir, full).replace(/\\/g, '/');
      if (e.isDirectory()) { out[`${rel}/`] = ''; walk(full); } else out[rel] = fs.readFileSync(full, 'latin1');
    }
  };
  walk(dir);
  return out;
}

/** A jail and a control folder beside it, set up before the jail goes up and removed after it comes down. */
function withJail(fn: (s: { jail: string; outside: string; logged: string[] }) => void | Promise<void>,
  prepare: (s: { jail: string; outside: string }) => void = () => {}) {
  return async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-jail-'));
    const jail = path.join(base, 'sandbox');
    const outside = path.join(base, 'real game');
    fs.mkdirSync(path.join(jail, 'inner'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'control.txt'), 'nobody touches this');
    fs.writeFileSync(path.join(jail, 'inner', 'mine.txt'), 'the sandbox own file');
    prepare({ jail, outside });
    const logged: string[] = [];
    const down = installWriteJail([jail], (m) => logged.push(m));
    try {
      await fn({ jail, outside, logged });
    } finally {
      down();
      fs.rmSync(base, { recursive: true, force: true });
    }
  };
}

test('writes inside the jail go through, in every form', withJail(async ({ jail }) => {
  const p = (...parts: string[]) => path.join(jail, ...parts);
  fs.writeFileSync(p('a.txt'), 'a');
  fs.appendFileSync(p('a.txt'), 'b');
  fs.mkdirSync(p('deep', 'er'), { recursive: true });
  fs.copyFileSync(p('a.txt'), p('deep', 'b.txt'));
  fs.renameSync(p('deep', 'b.txt'), p('deep', 'er', 'c.txt'));
  fs.closeSync(fs.openSync(p('d.txt'), 'w'));
  await fs.promises.writeFile(p('e.txt'), 'e');
  await new Promise<void>((resolve, reject) => fs.writeFile(p('f.txt'), 'f', (err) => (err ? reject(err) : resolve())));
  await new Promise<void>((resolve, reject) => {
    const w = fs.createWriteStream(p('g.txt'));
    w.on('error', reject).on('finish', resolve);
    w.end('g');
  });
  fs.rmSync(p('d.txt'));
  fs.unlinkSync(p('e.txt'));
  fs.rmSync(p('deep'), { recursive: true });
  assert.equal(fs.readFileSync(p('a.txt'), 'utf8'), 'ab');
  assert.equal(jailRefusals(), 0);
}));

test('every way out of the jail is refused, and the folder outside stays as it was', withJail(async ({ jail, outside, logged }) => {
  const before = snapshot(outside);
  const out = (...parts: string[]) => path.join(outside, ...parts);
  // a junction (Windows) or a directory symlink (elsewhere) inside the jail, pointing out of it
  const door = path.join(jail, 'door');
  fs.symlinkSync(outside, door, process.platform === 'win32' ? 'junction' : 'dir');

  const attempts: [string, () => unknown][] = [
    ['an absolute path', () => fs.writeFileSync(out('new.txt'), 'x')],
    ['a path through ..', () => fs.writeFileSync(path.join(jail, 'inner', '..', '..', 'real game', 'new.txt'), 'x')],
    ['a junction inside the jail', () => fs.writeFileSync(path.join(door, 'new.txt'), 'x')],
    ['a deep path that does not exist yet', () => fs.writeFileSync(out('a', 'b', 'c.txt'), 'x')],
    ['appending', () => fs.appendFileSync(out('control.txt'), 'x')],
    ['a folder', () => fs.mkdirSync(out('dir'), { recursive: true })],
    ['deleting', () => fs.rmSync(out('control.txt'))],
    ['unlinking through the junction', () => fs.unlinkSync(path.join(door, 'control.txt'))],
    ['renaming a file out of the folder into the jail', () => fs.renameSync(out('control.txt'), path.join(jail, 'stolen.txt'))],
    ['renaming into the folder', () => fs.renameSync(path.join(jail, 'inner', 'mine.txt'), out('moved.txt'))],
    ['copying into the folder', () => fs.copyFileSync(path.join(jail, 'inner', 'mine.txt'), out('copied.txt'))],
    ['copying a tree into the folder', () => fs.cpSync(path.join(jail, 'inner'), out('tree'), { recursive: true })],
    ['opening for writing', () => fs.openSync(out('control.txt'), 'r+')],
    ['opening with numeric flags', () => fs.openSync(out('new.txt'), fs.constants.O_CREAT | fs.constants.O_WRONLY)],
    ['truncating', () => fs.truncateSync(out('control.txt'))],
    ['touching', () => fs.utimesSync(out('control.txt'), 1, 1)],
    ['a link placed outside', () => fs.symlinkSync(path.join(jail, 'inner'), out('link'), process.platform === 'win32' ? 'junction' : 'dir')],
    ['a file URL', () => fs.writeFileSync(new URL(`file:///${out('url.txt').replace(/\\/g, '/').replace(/^\//, '')}`), 'x')],
    ['a write stream', () => fs.createWriteStream(out('stream.txt'))],
  ];
  for (const [how, attempt] of attempts) {
    assert.throws(attempt, (err: NodeJS.ErrnoException) => err.code === 'EPERM' && /outside the sandbox/.test(err.message), how);
  }
  await assert.rejects(fs.promises.writeFile(out('p.txt'), 'x'), /outside the sandbox/, 'the promise form');
  await assert.rejects(fs.promises.rm(out('control.txt')), /outside the sandbox/);
  await assert.rejects(fs.promises.rename(path.join(jail, 'inner', 'mine.txt'), out('m.txt')), /outside the sandbox/);
  await assert.rejects(new Promise<void>((resolve, reject) => fs.writeFile(out('cb.txt'), 'x', (err) => (err ? reject(err) : resolve()))), /outside the sandbox/, 'the callback form');

  // reading is not writing: the sandbox copies gameinfo out of the real game
  assert.equal(fs.readFileSync(out('control.txt'), 'utf8'), 'nobody touches this');
  fs.closeSync(fs.openSync(out('control.txt'), 'r'));

  assert.deepEqual(snapshot(outside), before, 'the folder outside is byte for byte what it was');
  assert.equal(jailRefusals(), attempts.length + 4);
  assert.equal(logged.length, attempts.length + 4);
  assert.ok(logged.every((l) => l.startsWith('write jail: refused ')));
}));

test('a game outside the jail is no game at all, so detection cannot hand it over', withJail(({ jail, outside }) => {
  assert.equal(validateGamePath(path.join(jail, 'game')), true);
  assert.equal(insideJail(path.join(outside, 'game')), false);
  assert.equal(validateGamePath(path.join(outside, 'game')), false, 'a whole game, and still not one');
}, ({ jail, outside }) => {
  // both games are put there before the jail is up: the outside one stands for the real install
  for (const root of [jail, outside]) {
    fs.mkdirSync(path.join(root, 'game', 'dota'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game', 'dota', 'pak01_dir.vpk'), 'x');
  }
}));

test('an install aimed at a game outside the jail writes nothing there, and says so', async () => {
  /* What happened on 2026-10-03, with the path check that should have stopped it broken on
     purpose: the saved game folder is the real one, and the installer is told to use it. */
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-jail-install-'));
  const sandbox = path.join(base, 'sandbox');
  const realGame = path.join(base, 'Steam', 'steamapps', 'common', 'dota 2 beta', 'game');
  fs.mkdirSync(path.join(realGame, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(realGame, 'dota', 'pak01_dir.vpk'), "the game's own archive");
  fs.mkdirSync(path.join(realGame, 'dota_russian'), { recursive: true });
  fs.writeFileSync(path.join(realGame, 'dota_russian', 'pak30_dir.vpk'), 'somebody else\'s mod');
  const userData = path.join(sandbox, 'userdata');
  const cache = path.join(userData, 'downloads', 'heroes');
  fs.mkdirSync(cache, { recursive: true });
  const zip = new AdmZip();
  zip.addFile('pak01_dir.vpk', Buffer.from('a mod'));
  fs.writeFileSync(path.join(cache, 'mod.zip'), zip.toBuffer());
  const before = snapshot(path.join(base, 'Steam'));

  const logged: string[] = [];
  const down = installWriteJail([sandbox], (m) => logged.push(m));
  try {
    const installer = new Installer({ userDataDir: userData, getGamePath: () => realGame, getLangSuffix: () => 'russian', onProgress: () => {} });
    const library = new Library(userData);
    const request = {
      categoryId: 'heroes', modName: 'Mod', fileRef: 'mod.zip',
      record: (files: Parameters<typeof library.add>[0]['files']) => { library.add({ name: 'Mod', categoryId: 'heroes', files }); },
    };
    // the first layer: a jailed run sees no game outside the sandbox, so the install stops at once
    await assert.rejects(installer.install(request), /holds no Dota 2 files/);
    // the second, with the first broken on purpose: the folder check passes, the writes do not
    installer.requireGameFolder = () => realGame;
    await assert.rejects(installer.install({
      categoryId: 'heroes', modName: 'Mod', fileRef: 'mod.zip',
      record: (files) => { library.add({ name: 'Mod', categoryId: 'heroes', files }); },
    }), /outside the sandbox/);
    assert.deepEqual(library.list(), [], 'no record either');
  } finally {
    down();
  }
  assert.deepEqual(snapshot(path.join(base, 'Steam')), before, 'the real game is byte for byte what it was');
  assert.ok(logged.length > 0 && logged.every((l) => l.includes(realGame) || l.includes('Steam')), logged.join('\n'));
  fs.rmSync(base, { recursive: true, force: true });
});

test('the switch names the folders, and a run without it is not jailed', () => {
  assert.deepEqual(jailFromArgv(['electron', '.', '--user-data-dir=x']), []);
  assert.deepEqual(jailFromArgv(['electron', '.', `--write-jail=a${path.delimiter}b`]), ['a', 'b']);
  assert.deepEqual(jailThisRun(['electron', '.'], {}), []);
  assert.deepEqual(jailRoots(), []);
  assert.equal(insideJail('C:\\anything'), true, 'no jail, no limit');
});

test('a jailed run lets in the temp folder and the folders the dev switches write to', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-jail-run-'));
  const sandbox = path.join(base, 'sandbox');
  const shots = path.join(base, 'e2e-output');
  const sim = path.join(base, 'e2e-output', 'sim', 'fhd--default');
  try {
    const roots = jailThisRun(['electron', '.', `--write-jail=${sandbox}`], {
      MM_SHOT: path.join(shots, '1-install.png'),
      MM_DIAG: path.join(shots, 'diag.log'),
      MM_SIM_OUT: sim,
    });
    try {
      const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
      assert.ok(roots.includes(fold(fs.realpathSync.native(sandbox))));
      assert.ok(roots.includes(fold(fs.realpathSync.native(os.tmpdir()))));
      assert.ok(roots.includes(fold(fs.realpathSync.native(shots))));
      assert.ok(roots.includes(fold(fs.realpathSync.native(sim))));
      assert.equal(insideJail(path.join(base, 'elsewhere', 'x')), roots.some((r) => fold(base).startsWith(r)), 'and nothing else');
    } finally {
      installWriteJail([base])();
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('every launch of the sandbox is jailed', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(JSON.parse(read('package.json')).scripts['start:sandbox'], /--write-jail=sandbox/);
  assert.match(read('tools/e2e.mjs'), /--write-jail=\$\{SANDBOX\}/);
  assert.match(read('tools/sim/run.mjs'), /--write-jail=\$\{path\.dirname\(USERDATA\)\}/);
  const main = read('src/main.ts');
  // before anything else in main.ts can write: the app log, the portable data folder
  const jailed = main.indexOf('jailThisRun(process.argv, process.env)');
  assert.ok(jailed > 0 && jailed < main.indexOf('createAppLog(') && jailed < main.indexOf('IS_PORTABLE'), 'the jail is up first');
  assert.match(main, /if \(app\.isPackaged && !jailRoots\(\)\.length\)/, 'a jailed run claims no system handler');
});

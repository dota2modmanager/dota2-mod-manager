/* The copy of the Workshop Tools kept on Linux (src/workshop-tools.ts), against a game laid out as
 * Steam lays out the Proton build, and the compiler running that copy once Steam has taken the
 * game's own away.
 *
 * What matters: the copy is the tools and not the game; a compile through it writes into the copy
 * and never through its links into the game; deleting it deletes the copy and nothing it links to;
 * and it is copied again only when the game's tools change, not after the user deleted it. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createToolsKeeper } from '../src/workshop-tools.ts';
import { compilerIn, createResourceCompiler } from '../src/resource-compiler.ts';
import { entryPath } from '../src/vpk.ts';
import type { RunProcess } from '../src/wine.ts';

const posix = process.platform !== 'win32';

function put(file: string, data = 'x') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

/** dota 2 beta while it runs through Proton: the tools in game/bin/win64, the Linux game beside them. */
function proton(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-wt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'dota 2 beta', 'game');
  put(compilerIn(game), 'MZ compiler');
  put(path.join(game, 'bin', 'win64', 'tier0.dll'), 'MZ tier0');
  put(path.join(game, 'bin', 'win64', 'tools', 'meshsystem.dll'), 'MZ mesh');
  put(path.join(game, 'bin', 'sdkenginetools.txt'), 'tools');
  put(path.join(game, 'bin', 'linuxsteamrt64', 'dota2'), 'ELF');
  put(path.join(game, 'dota', 'gameinfo.gi'), '"GameInfo" {}');
  put(path.join(game, 'core', 'pak01_dir.vpk'), 'core');
  return { root, game, userData: path.join(root, 'userdata') };
}

/** What Steam does on the way back to the Linux build: the Windows files go. */
const steamTakesThemAway = (game: string) => fs.rmSync(path.join(game, 'bin', 'win64'), { recursive: true, force: true });

/** A compiler that writes each source's compiled file where the real one does. */
const fakeCompiler: RunProcess = async (exe, args, opts) => {
  if (args[0] === 'wineboot') { put(path.join(String(opts.env?.WINEPREFIX), 'system.reg'), ''); return { code: 0, out: '' }; }
  const source = args[args.indexOf('-i') + 1].replace(/^Z:/, '').replace(/\\/g, '/');
  put(`${source.replace(`${path.sep}content${path.sep}`, `${path.sep}game${path.sep}`)}_c`, 'compiled');
  return { code: 0, out: '' };
};

test('the copy is the tools and the files beside them, with the game linked rather than copied', { skip: !posix }, async (t) => {
  const { game, userData } = proton(t);
  const keeper = createToolsKeeper({ dir: path.join(userData, 'workshop-tools'), gamePath: () => game });
  assert.equal(keeper.info(), null);
  assert.ok(keeper.wanted());
  const steps: number[] = [];
  const k2 = createToolsKeeper({ dir: path.join(userData, 'workshop-tools'), gamePath: () => game, onStep: (done) => steps.push(done) });
  assert.equal(await k2.keep(), true);
  const tree = path.join(userData, 'workshop-tools', 'tree', 'game');
  assert.equal(fs.readFileSync(path.join(tree, 'bin', 'win64', 'tools', 'meshsystem.dll'), 'utf8'), 'MZ mesh');
  assert.ok(fs.existsSync(path.join(tree, 'bin', 'sdkenginetools.txt')));
  assert.equal(fs.existsSync(path.join(tree, 'bin', 'linuxsteamrt64')), false, 'the Linux game is not copied');
  assert.equal(fs.readlinkSync(path.join(tree, 'dota')), path.join(game, 'dota'));
  assert.equal(fs.readlinkSync(path.join(tree, 'core')), path.join(game, 'core'));
  assert.ok(fs.lstatSync(path.join(tree, 'dota_addons')).isDirectory(), 'a folder of its own, not a link');
  assert.deepEqual(steps, [1, 2, 3, 4]);
  assert.equal(keeper.info()?.bytes, 'MZ compiler'.length + 'MZ tier0'.length + 'MZ mesh'.length + 'tools'.length);
  assert.equal(await keeper.keep(), false, 'the same tools are not copied twice');
});

test('once Steam takes the game\'s tools away, the copy compiles, into itself and not the game', { skip: !posix }, async (t) => {
  const { root, game, userData } = proton(t);
  const keeper = createToolsKeeper({ dir: path.join(userData, 'workshop-tools'), gamePath: () => game });
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => game, chosen: () => null, keeper, platform: 'linux', run: fakeCompiler, wine: () => '/usr/bin/wine' });
  assert.equal(rc.state().source, 'game');
  assert.ok(rc.state().keepable);
  await keeper.keep();
  steamTakesThemAway(game);
  const st = rc.state();
  assert.equal(st.source, 'kept');
  assert.ok(st.exe?.startsWith(path.join(userData, 'workshop-tools')));
  assert.equal(st.keepable, false, 'no tools in the game to copy');
  const out = await rc.compile({ id: 'x', files: [{ path: 'models/a.vmdl', data: Buffer.from('m') }], compile: ['models/a.vmdl'] });
  assert.deepEqual(out.map((e) => entryPath(e)), ['models/a.vmdl_c']);
  assert.deepEqual(fs.readdirSync(path.join(game, 'dota')), ['gameinfo.gi'], 'nothing written into the game through a link');
  assert.equal(fs.existsSync(path.join(root, 'dota 2 beta', 'content')), false);
});

test('deleting the copy deletes the copy, not the game it links to, and it is not copied back', { skip: !posix }, async (t) => {
  const { game, userData } = proton(t);
  const keeper = createToolsKeeper({ dir: path.join(userData, 'workshop-tools'), gamePath: () => game });
  await keeper.keep();
  keeper.remove();
  assert.equal(keeper.info(), null);
  assert.equal(fs.existsSync(path.join(userData, 'workshop-tools', 'tree')), false);
  assert.equal(fs.readFileSync(path.join(game, 'dota', 'gameinfo.gi'), 'utf8'), '"GameInfo" {}');
  assert.ok(fs.existsSync(path.join(game, 'core', 'pak01_dir.vpk')));
  assert.ok(fs.existsSync(compilerIn(game)));
  assert.equal(keeper.wanted(), false, 'the user said no to these tools');
  assert.ok(keeper.keepable(), 'Settings still offers it');
  assert.equal(await keeper.keep(), false);
  assert.equal(await keeper.keep({ force: true }), true, 'a press in Settings copies it again');
});

test('new tools in the game, a Dota patch under Proton, are copied again', { skip: !posix }, async (t) => {
  const { game, userData } = proton(t);
  const keeper = createToolsKeeper({ dir: path.join(userData, 'workshop-tools'), gamePath: () => game });
  await keeper.keep();
  put(compilerIn(game), 'MZ compiler, patched');
  assert.ok(keeper.wanted());
  assert.equal(await keeper.keep(), true);
  assert.equal(fs.readFileSync(path.join(userData, 'workshop-tools', 'tree', 'game', 'bin', 'win64', 'resourcecompiler.exe'), 'utf8'), 'MZ compiler, patched');
});

test('the links follow the game when it moves to another library', { skip: !posix }, async (t) => {
  const a = proton(t);
  const b = proton(t);
  let game = a.game;
  const keeper = createToolsKeeper({ dir: path.join(a.userData, 'workshop-tools'), gamePath: () => game });
  await keeper.keep();
  game = b.game;
  assert.ok(keeper.usable());
  assert.equal(fs.readlinkSync(path.join(a.userData, 'workshop-tools', 'tree', 'game', 'dota')), path.join(b.game, 'dota'));
});

test('a copy cut short is thrown away whole, and the old one stays in use', { skip: !posix || process.getuid?.() === 0 }, async (t) => {
  const { game, userData } = proton(t);
  const keeper = createToolsKeeper({ dir: path.join(userData, 'workshop-tools'), gamePath: () => game });
  await keeper.keep();
  const before = keeper.info();
  put(compilerIn(game), 'MZ newer');
  const locked = path.join(game, 'bin', 'win64', 'tools', 'meshsystem.dll');
  fs.chmodSync(locked, 0o000);
  t.after(() => { try { fs.chmodSync(locked, 0o644); } catch { /* the folder went first */ } });
  await assert.rejects(keeper.keep());
  assert.equal(fs.existsSync(path.join(userData, 'workshop-tools', 'tree.part')), false);
  assert.deepEqual(keeper.info(), before);
  assert.ok(keeper.usable());
});

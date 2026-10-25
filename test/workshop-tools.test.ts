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

import { createToolsKeeper, windowsOnly } from '../src/workshop-tools.ts';
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
  put(path.join(game, 'dota', 'pak01_dir.vpk'), 'dota');
  put(path.join(game, 'dota', 'bin', 'win64', 'modtools.dll'), 'MZ modtools');
  put(path.join(game, 'dota', 'bin', 'linuxsteamrt64', 'libserver.so'), 'ELF');
  put(path.join(game, 'dota', 'shaders_pc_dir.vpk'), 'dx11');
  put(path.join(game, 'dota', 'shaders_vulkan_dir.vpk'), 'vulkan');
  put(path.join(game, 'core', 'pak01_dir.vpk'), 'core');
  put(path.join(game, 'core', 'shaders_pc_dir.vpk'), 'core dx11');
  put(path.join(game, 'core', 'base.fgd'), 'fgd');
  put(path.join(game, 'dota', 'readonly_tools_asset_info.bin'), 'info');
  put(path.join(game, 'dota', 'tools', 'workshop_addoninfo.fgd'), 'fgd2');
  put(path.join(game, 'dota', 'tools', 'images', 'icon.png'), 'png');
  return { root, game, userData: path.join(root, 'userdata') };
}

/* What Steam does on the way back to the Linux build: the Windows files go, the tools and Dota's
 * own Windows libraries and DX11 shaders alike, and the folders stay behind empty. */
function steamTakesThemAway(game: string) {
  for (const dir of [path.join(game, 'bin', 'win64'), path.join(game, 'dota', 'bin', 'win64')]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
  }
  for (const f of ['dota/shaders_pc_dir.vpk', 'core/shaders_pc_dir.vpk', 'core/base.fgd', 'dota/readonly_tools_asset_info.bin', 'dota/tools/workshop_addoninfo.fgd']) fs.rmSync(path.join(game, f));
}

test('of game/dota and game/core, only the Windows build\'s own entries are copied', () => {
  for (const yes of ['bin/win64/modtools.dll', 'shaders_pc_dir.vpk', 'shaders_pc_000.vpk', 'models_gamedata.fgd', 'tools/workshop_addoninfo.fgd', 'readonly_tools_asset_info.bin']) assert.ok(windowsOnly(yes), yes);
  for (const no of ['bin/linuxsteamrt64/libserver.so', 'shaders_pcgl_dir.vpk', 'shaders_vulkan_dir.vpk', 'pak01_dir.vpk', 'gameinfo.gi', 'maps/shaders_pc_x.vpk', 'tools/images/icon.png']) assert.equal(windowsOnly(no), false, no);
});

/** A compiler that writes each source's compiled file where the real one does. */
const fakeCompiler: RunProcess = async (exe, args, opts) => {
  if (args[0] === 'wineboot') { put(path.join(String(opts.env?.WINEPREFIX), 'system.reg'), ''); return { code: 0, out: '' }; }
  const source = args[args.indexOf('-i') + 1].replace(/^Z:/, '').replace(/\\/g, '/');
  put(`${source.replace(`${path.sep}content${path.sep}`, `${path.sep}game${path.sep}`)}_c`, 'compiled');
  return { code: 0, out: '' };
};

test('the copy is the Windows build\'s own files, with the rest of the game linked entry by entry', { skip: !posix }, async (t) => {
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
  const real = (rel: string) => !fs.lstatSync(path.join(tree, rel)).isSymbolicLink();
  for (const rel of ['dota', 'dota/bin', 'dota/bin/win64/modtools.dll', 'dota/shaders_pc_dir.vpk', 'dota/readonly_tools_asset_info.bin', 'dota/tools/workshop_addoninfo.fgd', 'core', 'core/shaders_pc_dir.vpk', 'core/base.fgd', 'dota_addons']) assert.ok(real(rel), `${rel} is the copy's own`);
  for (const rel of ['dota/pak01_dir.vpk', 'dota/gameinfo.gi', 'dota/shaders_vulkan_dir.vpk', 'dota/bin/linuxsteamrt64', 'dota/tools/images', 'core/pak01_dir.vpk']) {
    assert.equal(fs.readlinkSync(path.join(tree, rel)), path.join(game, rel), `${rel} is linked`);
  }
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(keeper.info()?.bytes, ['MZ compiler', 'MZ tier0', 'MZ mesh', 'tools', 'MZ modtools', 'dx11', 'info', 'fgd2', 'core dx11', 'fgd'].join('').length);
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
  assert.ok(fs.existsSync(path.join(st.exe!, '..', '..', '..', 'dota', 'bin', 'win64', 'modtools.dll')), 'Dota\'s own Windows libraries stay in the copy');
  assert.deepEqual(fs.readdirSync(path.join(game, 'dota')).sort(), ['bin', 'gameinfo.gi', 'pak01_dir.vpk', 'shaders_vulkan_dir.vpk', 'tools'], 'nothing written into the game through a link');
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

test('the links follow the game: a moved library, a file a patch adds and one it removes', { skip: !posix }, async (t) => {
  const a = proton(t);
  const b = proton(t);
  let game = a.game;
  const keeper = createToolsKeeper({ dir: path.join(a.userData, 'workshop-tools'), gamePath: () => game });
  await keeper.keep();
  const dota = path.join(a.userData, 'workshop-tools', 'tree', 'game', 'dota');
  game = b.game;
  put(path.join(b.game, 'dota', 'pak01_007.vpk'), 'new');
  fs.rmSync(path.join(b.game, 'dota', 'pak01_dir.vpk'));
  assert.ok(keeper.usable());
  assert.equal(fs.readlinkSync(path.join(dota, 'gameinfo.gi')), path.join(b.game, 'dota', 'gameinfo.gi'));
  assert.equal(fs.readlinkSync(path.join(dota, 'pak01_007.vpk')), path.join(b.game, 'dota', 'pak01_007.vpk'));
  assert.equal(fs.existsSync(path.join(dota, 'pak01_dir.vpk')), false);
  assert.equal(fs.readFileSync(path.join(dota, 'bin', 'win64', 'modtools.dll'), 'utf8'), 'MZ modtools', 'what was copied stays');
});

test('a copy made before Dota\'s own Windows files were copied is not run, and is made again', { skip: !posix }, async (t) => {
  const { game, userData } = proton(t);
  const dir = path.join(userData, 'workshop-tools');
  const keeper = createToolsKeeper({ dir, gamePath: () => game });
  await keeper.keep();
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'kept.json'), 'utf8'));
  delete record.layout;
  fs.writeFileSync(path.join(dir, 'kept.json'), JSON.stringify(record));
  assert.equal(keeper.info(), null);
  assert.equal(keeper.usable(), null);
  assert.ok(keeper.outdated(), 'Settings says to make it again');
  assert.ok(keeper.wanted());
  assert.equal(await keeper.keep(), true);
  assert.ok(keeper.usable());
  assert.equal(keeper.outdated(), false);
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

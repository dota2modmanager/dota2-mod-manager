/* resourcecompiler.exe as the app runs it (src/resource-compiler.ts), against an install laid out
 * the way Steam lays one out and a compiler that is a function: it writes what the real one writes,
 * where the real one writes it.
 *
 * What matters: only a compiler where the Workshop Tools put one is run; the sources go to an addon
 * of ours and nothing of it is left in the install afterwards, whether the compile worked or not;
 * a failure says what the compiler said; on Linux it goes through Wine with Windows paths; and two
 * compiles never run at once. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compilerIn, createResourceCompiler, installOf, safeRel, type CompileJob } from '../src/resource-compiler.ts';
import { entryPath } from '../src/vpk.ts';
import type { RunProcess } from '../src/wine.ts';

const posix = process.platform !== 'win32';

/** dota 2 beta with the Workshop Tools: the compiler in game/bin/win64 and the game beside it. */
function install(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-rc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'game');
  fs.mkdirSync(path.join(game, 'bin', 'win64'), { recursive: true });
  fs.writeFileSync(compilerIn(game), 'MZ');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'gameinfo.gi'), '"GameInfo" {}');
  return { root, game, exe: compilerIn(game), userData: path.join(root, 'userdata') };
}

/** Where a source in our addon compiles to, as the real compiler writes it. */
const compiledOf = (source: string) => `${source.replace(`${path.sep}content${path.sep}`, `${path.sep}game${path.sep}`)}_c`;
const fromWine = (p: string) => p.replace(/^Z:/, '').replace(/\\/g, '/');

/** A compiler that writes each source's compiled file, a by-product, and the tools' own note. */
function fakeCompiler({ code = 0, writes = true, calls = [] as string[][] } = {}): RunProcess {
  return async (exe, args, opts) => {
    calls.push([exe, ...args, `cwd=${opts.cwd}`]);
    if (args[0] === 'wineboot') {
      fs.writeFileSync(path.join(String(opts.env?.WINEPREFIX), 'system.reg'), '');
      return { code: 0, out: '' };
    }
    const raw = args[args.indexOf('-i') + 1];
    const source = raw.startsWith('Z:') ? fromWine(raw) : raw;
    if (writes) {
      const out = compiledOf(source);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `compiled ${fs.readFileSync(source, 'utf8')}`);
      fs.mkdirSync(path.join(path.dirname(out), 'razor'), { recursive: true });
      fs.writeFileSync(path.join(path.dirname(out), 'razor', 'razor_head_vmorf.vtex_c'), 'morph');
      const addon = out.slice(0, out.indexOf(`${path.sep}models${path.sep}`));
      fs.writeFileSync(path.join(addon, 'tools_asset_info.bin'), 'tools');
    }
    return { code, out: code ? 'Error: models/heroes/razor/razor.vmdl: missing mesh razor_lod0.dmx\nFAILED: 1 compiled, 1 failed\n' : 'OK: 1 compiled\n' };
  };
}

const job: CompileJob = {
  id: 'voidstorm_asylum',
  files: [
    { path: 'models/heroes/razor/razor.vmdl', data: Buffer.from('<!-- kv3 -->') },
    { path: 'models/items/razor/razor_arcana/razor_lod0.dmx', data: Buffer.from('dmx') },
  ],
  compile: ['models/heroes/razor/razor.vmdl'],
};

const addonsOf = (root: string) => ['content', 'game'].flatMap((d) => {
  try { return fs.readdirSync(path.join(root, d, 'dota_addons')); } catch { return []; }
});

test('a compiler counts only where the Workshop Tools put one, in an install with the game', (t) => {
  const { root, exe } = install(t);
  assert.equal(installOf(exe), root);
  assert.equal(installOf(null), null);
  const loose = path.join(root, 'resourcecompiler.exe');
  fs.writeFileSync(loose, 'MZ');
  assert.equal(installOf(loose), null, 'a copy outside game/bin/win64 finds no game');
  const other = path.join(path.dirname(exe), 'dota2.exe');
  fs.writeFileSync(other, 'MZ');
  assert.equal(installOf(other), null, 'not the compiler');
  fs.rmSync(path.join(root, 'game', 'dota', 'gameinfo.gi'));
  assert.equal(installOf(exe), null, 'no game beside it');
});

test('a path in an addon cannot climb out of it or name a drive', () => {
  for (const ok of ['models/heroes/razor/razor.vmdl', 'models/items/axe/@axe_bot.dmx']) assert.ok(safeRel(ok), ok);
  for (const bad of ['', '/etc/passwd', '../x.vmdl', 'models/../../x', 'models//x', 'C:/x', 'models\\x', 'models/./x']) assert.equal(safeRel(bad), false, bad);
});

test('the compiler picked in Settings runs over the game\'s own, and a wrong pick is passed over', (t) => {
  const a = install(t);
  const b = install(t);
  let picked: string | null = b.exe;
  const rc = createResourceCompiler({ userDataDir: a.userData, gamePath: () => a.game, chosen: () => picked, platform: 'win32' });
  assert.deepEqual(rc.locate(), { exe: b.exe, install: b.root, source: 'chosen' });
  picked = path.join(b.root, 'nothing.exe');
  assert.deepEqual(rc.locate(), { exe: a.exe, install: a.root, source: 'game' });
  const none = createResourceCompiler({ userDataDir: a.userData, gamePath: () => null, chosen: () => null, platform: 'win32' });
  assert.equal(none.locate(), null);
  assert.equal(none.state().ready, false);
  assert.equal(rc.state().ready, true, 'Windows needs nothing more');
});

test('on Windows a job compiles from our addon and comes back as the compiled files, leaving nothing behind', async (t) => {
  const { root, exe, game, userData } = install(t);
  const calls: string[][] = [];
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => game, chosen: () => null, platform: 'win32', run: fakeCompiler({ calls }) });
  const entries = await rc.compile(job);
  const source = path.join(root, 'content', 'dota_addons', 'd2mm_voidstorm_asylum', 'models', 'heroes', 'razor', 'razor.vmdl');
  assert.deepEqual(calls, [[exe, '-nop4', '-f', '-i', source, `cwd=${path.dirname(exe)}`]]);
  assert.deepEqual(entries.map((e) => entryPath(e)).sort(), ['models/heroes/razor/razor.vmdl_c', 'models/heroes/razor/razor/razor_head_vmorf.vtex_c']);
  assert.equal(entries.find((e) => entryPath(e) === 'models/heroes/razor/razor.vmdl_c')?.data?.toString(), 'compiled <!-- kv3 -->');
  assert.deepEqual(addonsOf(root), [], 'the addon is gone from content and game');
});

test('on Linux it runs through Wine, in the app\'s prefix, with Windows paths', { skip: !posix }, async (t) => {
  const { root, exe, userData } = install(t);
  const calls: string[][] = [];
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => null, chosen: () => exe, platform: 'linux', run: fakeCompiler({ calls }), wine: () => '/usr/bin/wine' });
  assert.equal(rc.state().ready, false, 'no prefix yet');
  const entries = await rc.compile(job);
  assert.deepEqual(calls[0].slice(0, 3), ['/usr/bin/wine', 'wineboot', '--init'], 'the prefix is made by the first compile');
  assert.equal(calls[1][0], '/usr/bin/wine');
  assert.equal(calls[1][1], exe);
  assert.equal(calls[1][5], `Z:${path.join(root, 'content', 'dota_addons', 'd2mm_voidstorm_asylum', 'models', 'heroes', 'razor', 'razor.vmdl').replace(/\//g, '\\')}`);
  assert.equal(entries.length, 2);
  assert.ok(rc.state().ready);
});

test('on Linux with no Wine, a compile says what to install and writes nothing', { skip: !posix }, async (t) => {
  const { root, exe, userData } = install(t);
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => null, chosen: () => exe, platform: 'linux', run: fakeCompiler(), wine: () => null });
  await assert.rejects(rc.compile(job), /Wine/);
  assert.deepEqual(addonsOf(root), []);
});

test('with no compiler at all, a compile says where one comes from', async (t) => {
  const { userData } = install(t);
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => null, chosen: () => null, platform: 'win32', run: fakeCompiler() });
  await assert.rejects(rc.compile(job), /Workshop Tools/);
});

test('a compile that fails says what the compiler said, and still leaves nothing behind', async (t) => {
  const { root, game, userData } = install(t);
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => game, chosen: () => null, platform: 'win32', run: fakeCompiler({ code: 1 }) });
  await assert.rejects(rc.compile(job), /razor\.vmdl.*missing mesh razor_lod0\.dmx.*FAILED/);
  assert.deepEqual(addonsOf(root), []);
});

test('a compiler that answers 0 and makes nothing has failed too', async (t) => {
  const { game, userData } = install(t);
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => game, chosen: () => null, platform: 'win32', run: fakeCompiler({ writes: false }) });
  await assert.rejects(rc.compile(job), /models\/heroes\/razor\/razor\.vmdl/);
});

test('a job that names a path out of its addon, a bad addon, or a source it does not carry is refused before anything is written', async (t) => {
  const { root, game, userData } = install(t);
  const calls: string[][] = [];
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => game, chosen: () => null, platform: 'win32', run: fakeCompiler({ calls }) });
  await assert.rejects(rc.compile({ ...job, files: [...job.files, { path: '../../game/dota/gameinfo.gi', data: Buffer.from('x') }] }), /not a path inside an addon/);
  await assert.rejects(rc.compile({ ...job, id: '../dota' }), /not an addon name/);
  await assert.rejects(rc.compile({ ...job, compile: ['models/heroes/razor/razor_armor.vmdl'] }), /not among the sources/);
  assert.deepEqual(calls, []);
  assert.deepEqual(addonsOf(root), []);
  assert.equal(fs.readFileSync(path.join(game, 'dota', 'gameinfo.gi'), 'utf8'), '"GameInfo" {}');
});

test('two compiles asked for at once run one after the other, and a failed one does not stop the next', async (t) => {
  const { game, userData } = install(t);
  let running = 0;
  let most = 0;
  let first = true;
  const inner = fakeCompiler();
  const run: RunProcess = async (exe, args, opts) => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 20));
    try {
      if (first) { first = false; return { code: 1, out: 'boom' }; }
      return await inner(exe, args, opts);
    } finally { running--; }
  };
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => game, chosen: () => null, platform: 'win32', run });
  const [a, b] = await Promise.allSettled([rc.compile(job), rc.compile({ ...job, id: 'bladeform_legacy' })]);
  assert.equal(a.status, 'rejected');
  assert.equal(b.status, 'fulfilled');
  assert.equal(most, 1);
});

test('the check compiles an empty model, says each step, and is kept for this compiler', { skip: !posix }, async (t) => {
  const { root, exe, userData } = install(t);
  const calls: string[][] = [];
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => null, chosen: () => exe, platform: 'linux', run: fakeCompiler({ calls }), wine: () => '/usr/bin/wine' });
  assert.equal(rc.state().check, null, 'not checked yet');
  const steps: string[] = [];
  const [a, b] = await Promise.all([rc.check((s) => steps.push(s)), rc.check()]);
  assert.equal(a, b, 'a second press while one runs gets the same answer');
  assert.ok(a.ok);
  assert.deepEqual(steps, ['wine', 'compile']);
  assert.equal(calls.filter((c) => c.includes('-i')).length, 1, 'one compile');
  assert.match(calls.find((c) => c.includes('-i'))!.join(' '), /d2mm_check\\models\\d2mm_check\\empty\.vmdl/);
  assert.equal(rc.state().check?.ok, true);
  assert.deepEqual(addonsOf(root), []);
  // a patch that brings a new compiler makes it unchecked again
  fs.utimesSync(exe, new Date(), new Date(Date.now() + 60000));
  assert.equal(rc.state().check, null);
});

test('a check that fails keeps what the compiler said', async (t) => {
  const { game, userData } = install(t);
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => game, chosen: () => null, platform: 'win32', run: fakeCompiler({ code: 1 }) });
  const steps: string[] = [];
  const result = await rc.check((s) => steps.push(s));
  assert.equal(result.ok, false);
  assert.deepEqual(steps, ['compile'], 'Windows has no Wine step');
  assert.match(result.message || '', /FAILED/);
  assert.equal(rc.state().check?.ok, false);
});

test('with no compiler the check fails with where one comes from, and nothing is kept', async (t) => {
  const { userData } = install(t);
  const rc = createResourceCompiler({ userDataDir: userData, gamePath: () => null, chosen: () => null, platform: 'win32', run: fakeCompiler() });
  const result = await rc.check();
  assert.equal(result.ok, false);
  assert.match(result.message || '', /Workshop Tools/);
  assert.equal(fs.existsSync(path.join(userData, 'compiler-check.json')), false);
});

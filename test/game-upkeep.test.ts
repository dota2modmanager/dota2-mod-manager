/* Keeping the game folder right (src/game-upkeep.ts): the mod folder follows the audio language,
 * what Steam's file check takes is put back, a Dota patch is repaired or waited out, and the work
 * at start goes on past a step that fails.
 *
 * The game is a throwaway folder shaped like Steam's. The installer and the item table are fakes
 * that record what they were asked, because their own tests cover the files they write; what is
 * tested here is what this module decides and when.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import './helpers/no-steam.ts';
import { createGameUpkeep, dotaIsRunning, runSteps, type PatchRepair } from '../src/game-upkeep.ts';
import { gameStamp } from '../src/patch-watch.ts';

const bootFile = (ui: string, audio: string) => `"boot"\n{\n\t"UILanguage"\t\t"${ui}"\n\t"AudioLanguage"\t\t"${audio}"\n}\n`;

/** A ...\dota 2 beta\game tree: the build number, the boot languages and any folders asked for. */
function fakeGame(t: TestContext, { audio = 'russian', build = '6000', folders = {} as Record<string, string[]> } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-upkeep-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'steamapps', 'common', 'dota 2 beta', 'game');
  fs.mkdirSync(path.join(game, 'dota', 'cfg'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'cfg', 'boot.vcfg'), bootFile('english', audio));
  fs.writeFileSync(path.join(game, 'dota', 'steam.inf'), `ClientVersion=${build}\n`);
  for (const [name, files] of Object.entries(folders)) {
    fs.mkdirSync(path.join(game, name), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(game, name, f), 'x');
  }
  return game;
}

type Rec = { id: string; name: string };

function stand({ game = null as string | null, running = false, stored = {} as Record<string, unknown>, lost = [] as Rec[],
  restore = (_r: Rec): string | null => null, heal = () => ({ healed: [] as string[], error: null as string | null }),
  failLegacy = false, slotsMoved = 0, findGame = async (): Promise<string | null> => null,
  reach = null as (() => { from: string | null; to: string | null; ids: string[] } | null) | null, mods = [] as Rec[] } = {}) {
  const store = new Map<string, unknown>(Object.entries({ dotaGamePath: game, ...stored }));
  const said: string[] = [];
  const sent: PatchRepair[] = [];
  const asked: string[] = [];
  let isRunning = running;
  const upkeep = createGameUpkeep({
    settings: { get: ((k: string) => store.get(k) ?? null) as never, set: ((k: string, v: unknown) => { store.set(k, v); }) as never },
    installer: {
      lostToVerify: () => lost,
      restoreDeployed: (r: Rec) => restore(r),
      migrateLegacyPriorityPaks: () => { asked.push('legacy'); if (failLegacy) throw new Error('boom'); },
      migrateSlotZones: () => { asked.push('slots'); return { moved: slotsMoved }; },
      mergeMultiPartRecords: () => { asked.push('merge'); },
      sweepStaged: () => { asked.push('sweep'); return { restored: 0, dropped: 0 }; },
    } as never,
    library: { list: () => mods } as never,
    schemaService: {
      heal: () => { asked.push('heal'); return heal(); },
      migrate: () => ({ changed: 0 }),
      migrateCosmeticSettings: () => { asked.push('cosmetics'); },
    } as never,
    updateImpact: reach ? { check: reach } : null,
    reconcileCursors: () => { asked.push('cursors'); },
    diag: (m) => said.push(m),
    send: (r) => sent.push(r),
    isRunning: async () => isRunning,
    findGame,
    validGame: (p) => typeof p === 'string' && fs.existsSync(path.join(p, 'dota')),
    retryMs: 5,
    now: () => 1000,
  });
  return { upkeep, store, said, sent, asked, setRunning: (v: boolean) => { isRunning = v; } };
}

test('Dota is found running by the tool each system has, and a missing tool means not running', async () => {
  const seen: string[] = [];
  const answer = (out: string, err: Error | null = null) => (cmd: string, args: string[], done: (e: Error | null, o: string) => void) => {
    seen.push(`${cmd} ${args.join(' ')}`);
    done(err, out);
  };
  assert.equal(await dotaIsRunning({ platform: 'win32', run: answer('dota2.exe   1234 Console   1   900 K') }), true);
  assert.equal(await dotaIsRunning({ platform: 'win32', run: answer('INFO: No tasks are running which match the specified criteria.') }), false);
  assert.equal(await dotaIsRunning({ platform: 'linux', run: answer('4242\n') }), true);
  assert.equal(await dotaIsRunning({ platform: 'linux', run: answer('', new Error('exit 1')) }), false);
  assert.equal(await dotaIsRunning({ platform: 'linux', run: answer('4242\n', new Error('pgrep: not found')) }), false);
  assert.deepEqual(seen.slice(0, 3), ['tasklist /FI IMAGENAME eq dota2.exe /NH', 'tasklist /FI IMAGENAME eq dota2.exe /NH', 'pgrep -x dota2'],
    'an exact process name on Linux, so a browser tab about Dota is not the game');
});

test('Russian audio keeps its own folder, and nothing is written to the game\'s settings', async (t) => {
  const game = fakeGame(t, { audio: 'russian', folders: { dota_russian: ['gameinfo.gi'] } });
  const boot = fs.readFileSync(path.join(game, 'dota', 'cfg', 'boot.vcfg'), 'utf8');
  const s = stand({ game });
  await s.upkeep.keepModFolder();
  assert.equal(s.upkeep.langFolder(), 'russian');
  assert.equal(s.store.get('langSuffix'), 'russian');
  assert.equal(fs.readFileSync(path.join(game, 'dota', 'cfg', 'boot.vcfg'), 'utf8'), boot);
  assert.equal(s.upkeep.takeLangMigration(), null);
});

test('English audio is pointed at the Russian folder, and the mods follow it there once', async (t) => {
  const game = fakeGame(t, { audio: 'english', folders: { dota_english: ['pak30_dir.vpk'] } });
  const s = stand({ game, stored: { langSuffix: 'english' } });
  await s.upkeep.keepModFolder();
  assert.match(fs.readFileSync(path.join(game, 'dota', 'cfg', 'boot.vcfg'), 'utf8'), /"AudioLanguage"\s+"russian"/);
  assert.ok(fs.existsSync(path.join(game, 'dota_russian', 'gameinfo.gi')), 'the folder English has none of is made, shaped like Valve\'s');
  assert.ok(fs.existsSync(path.join(game, 'dota_russian', 'pak30_dir.vpk')), 'the mod moved with it');
  assert.equal(s.store.get('langSuffix'), 'russian');
  assert.deepEqual(s.upkeep.takeLangMigration(), { from: 'english', to: 'russian', moved: 1 });
  assert.equal(s.upkeep.takeLangMigration(), null, 'told once');
});

test('with Dota running its settings are left alone, and the move waits for the next start', async (t) => {
  const game = fakeGame(t, { audio: 'english' });
  const s = stand({ game, running: true });
  await s.upkeep.keepModFolder();
  assert.match(fs.readFileSync(path.join(game, 'dota', 'cfg', 'boot.vcfg'), 'utf8'), /"AudioLanguage"\s+"english"/);
  assert.equal(s.store.has('langSuffix'), false);
  assert.match(s.said.join('\n'), /Dota is running - leaving boot\.vcfg alone/);
});

test('what Steam took is put back from what the app holds, and the rest is named', () => {
  const lost = [{ id: 'a', name: 'Cursor' }, { id: 'b', name: 'Font' }, { id: 'c', name: 'Broken' }];
  const s = stand({
    lost,
    restore: (r) => {
      if (r.id === 'c') throw new Error('locked');
      return r.id === 'a' ? 'store' : null;
    },
  });
  assert.equal(s.upkeep.restoreAfterVerify(), 1);
  assert.deepEqual(s.upkeep.verifyStuck(), [{ id: 'b', name: 'Font' }, { id: 'c', name: 'Broken' }]);
  assert.match(s.said.join('\n'), /restore failed for Broken: locked/);
});

test('a patch while Dota runs waits for it to close, then repairs and remembers the new build', async (t) => {
  const game = fakeGame(t, { build: '6001' });
  const s = stand({ game, running: true, lost: [{ id: 'a', name: 'Cursor' }], restore: () => 'store',
    heal: () => ({ healed: ['patch', 'schema'], error: null }) });
  await s.upkeep.repairAfterPatch('steam.inf');
  assert.deepEqual(s.sent, [{ state: 'waiting', reason: 'steam.inf', at: 1000 }]);
  assert.equal(s.store.has('gameStamp'), false, 'nothing written while the game holds its files');

  s.setRunning(false);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(s.sent.at(-1), { state: 'done', healed: ['patch', 'schema', 'files'], error: null, at: 1000 });
  assert.equal(s.store.get('gameStamp'), gameStamp(game));
  s.upkeep.stop();
});

test('a repair that fails says so, and a patch with no game set does nothing', async (t) => {
  const game = fakeGame(t);
  const s = stand({ game, heal: () => ({ healed: [], error: 'gameinfo is read-only' }) });
  await s.upkeep.repairAfterPatch();
  assert.equal(s.sent[0].state, 'failed');
  assert.equal(s.sent[0].error, 'gameinfo is read-only');

  const none = stand();
  await none.upkeep.repairAfterPatch();
  assert.deepEqual(none.sent, []);
});

test('a game patched while the app was closed is repaired at start and reported once the window asks', async (t) => {
  const game = fakeGame(t, { build: '6002' });
  const s = stand({ game, stored: { gameStamp: '6001:?' }, heal: () => ({ healed: ['schema'], error: null }) });
  await s.upkeep.atStart();
  assert.deepEqual(s.upkeep.patchRepair(), { state: 'done', healed: ['schema'], error: null, at: 1000 });
  assert.equal(s.store.get('gameStamp'), gameStamp(game));
  assert.deepEqual(s.sent, [], 'no window yet: the state waits to be asked for');

  const same = stand({ game, stored: { gameStamp: gameStamp(game) } });
  await same.upkeep.atStart();
  assert.equal(same.upkeep.patchRepair().state, 'idle', 'the same build is nothing to tell');
});

test('the mods a patch reached are named in the repair, at start and while the app is open', async (t) => {
  const game = fakeGame(t, { build: '6946' });
  const reached = { from: '6944', to: '6946', ids: ['hud', 'removed-since'] };
  const mods = [{ id: 'hud', name: 'Golden HUD' }];

  const start = stand({ game, stored: { gameStamp: gameStamp(game) }, reach: () => reached, mods });
  await start.upkeep.atStart();
  assert.deepEqual(start.upkeep.patchRepair().touched, { build: '6946', mods: ['Golden HUD', 'removed-since'] },
    'told even when the build stamp did not move: the index did');

  const live = stand({ game, reach: () => reached, mods });
  await live.upkeep.repairAfterPatch();
  assert.deepEqual(live.sent.at(-1)?.touched, { build: '6946', mods: ['Golden HUD', 'removed-since'] });

  const quiet = stand({ game, reach: () => null });
  await quiet.upkeep.repairAfterPatch();
  assert.equal('touched' in (quiet.sent.at(-1) || {}), false, 'a patch that reached nothing adds nothing');

  const broken = stand({ game, reach: () => { throw new Error('pak01 unreadable'); } });
  await broken.upkeep.repairAfterPatch();
  assert.equal(broken.sent.at(-1)?.state, 'done', 'the repair stands without it');
  assert.ok(broken.said.some((m) => m.includes('update impact skipped')));
});

test('a step that fails at start is logged and the ones after it still run', async (t) => {
  const s = stand({ game: fakeGame(t), failLegacy: true, slotsMoved: 3 });
  await s.upkeep.atStart();
  assert.ok(s.said.includes('legacy pak migration skipped: boom'));
  assert.deepEqual(s.asked, ['legacy', 'slots', 'merge', 'cursors', 'sweep', 'cosmetics', 'heal']);
  assert.equal(s.store.get('slotZones'), 1);
  assert.deepEqual(s.upkeep.takeSlotMigration(), { moved: 3 });
  assert.equal(s.upkeep.takeSlotMigration(), null);
});

test('the load order is laid out once, and not while Dota holds the files', async (t) => {
  const running = stand({ game: fakeGame(t), running: true });
  await running.upkeep.atStart();
  assert.ok(!running.asked.includes('slots'));
  assert.equal(running.store.has('slotZones'), false, 'tried again at the next start');

  const done = stand({ game: fakeGame(t), stored: { slotZones: 1 } });
  await done.upkeep.atStart();
  assert.ok(!done.asked.includes('slots'));
});

test('a saved game path that stopped being a game is replaced, or forgotten when there is none', async (t) => {
  const moved = fakeGame(t);
  const s = stand({ game: path.join(os.tmpdir(), 'd2mm-gone-drive'), findGame: async () => moved });
  await s.upkeep.atStart();
  assert.equal(s.store.get('dotaGamePath'), moved);
  assert.match(s.said[0], /is no longer an install, moved to/);

  const lost = stand({ game: path.join(os.tmpdir(), 'd2mm-gone-drive') });
  await lost.upkeep.atStart();
  assert.equal(lost.store.get('dotaGamePath'), null);

  let looked = false;
  const fine = stand({ game: fakeGame(t), findGame: async () => { looked = true; return null; } });
  await fine.upkeep.atStart();
  assert.equal(looked, false, 'a path that is still a game is not searched for again');
});

test('runSteps goes on past a step that throws and awaits one that is slow', async () => {
  const order: string[] = [];
  const said: string[] = [];
  await runSteps([
    { name: 'first', run: async () => { await new Promise((r) => setTimeout(r, 5)); order.push('first'); } },
    { name: 'second', run: () => { throw new Error('no'); } },
    { name: 'third', run: () => { order.push('third'); } },
  ], (m) => said.push(m));
  assert.deepEqual(order, ['first', 'third']);
  assert.deepEqual(said, ['second skipped: no']);
});

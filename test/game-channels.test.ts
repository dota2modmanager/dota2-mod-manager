/* The channels about the game rather than a mod (src/ipc-game.ts): the search-path patch switch,
 * the patch repair banner, the notices, item and hero pictures, mod previews, the toolchain and
 * cosmetic picks.
 *
 * Most of what they do is decide between sources and refuse at the right moment, which is exactly
 * what had no test: the module's branches were 52% covered. The services behind them have tests
 * of their own, so here they are stand-ins that record what they were asked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { registerGameIpc } from '../src/ipc-game.ts';
import { t as say } from '../src/i18n.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

type Repair = { state: string };

function stand(over: Record<string, unknown> = {}) {
  const said: string[] = [];
  const settingsData: Record<string, unknown> = { dotaGamePath: 'C:/game', uiLang: 'en', seenNotices: [] };
  let repair: Repair = { state: 'idle' };
  let switchedOff: string | null = null;
  let running = false;
  const asked: string[] = [];
  const ctx = {
    blocked: (feature: string) => (feature === switchedOff ? { error: `${feature} is off today`, blocked: true } : null),
    diag: (m: string) => said.push(m),
    dotaIsRunning: async () => running,
    settings: { get: (k: string) => settingsData[k], set: (k: string, v: unknown) => { settingsData[k] = v; } },
    patchRepair: () => repair,
    setPatchRepair: (next: Repair) => { repair = next; },
    repairAfterPatch: async (reason: string) => { asked.push(`repair ${reason}`); repair = { state: 'done' }; },
    remoteConfig: { SWITCHABLE: ['install'], feature: () => ({ off: false, note: '' }), notices: () => [] },
    schemaService: {
      state: () => ({ enabled: false }),
      setEnabled: (on: boolean) => { asked.push(`patch ${on}`); return { ok: true }; },
      pickCosmetic: (slot: string, itemId: string) => ({ id: `${slot}:${itemId}` }),
      pickSet: (setId: string) => ({ records: [setId] }),
    },
    modPreviews: {
      VID: 'modvid:', ART: 'modart:', TEX: 'modtex:',
      getMany: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k.includes('has')).map((k) => [k, `art of ${k}`])),
      hasVideo: (k: string) => k.includes('clip'),
      videoBytes: () => ({ bytes: Buffer.from('webm') }),
      saveFrame: () => 'data:image/png;base64,AA==',
      size: () => 20, clear: () => asked.push('previews cleared'),
    },
    gameIcons: {
      getMany: async (names: string[]) => Object.fromEntries(names.filter((n) => n.startsWith('game')).map((n) => [n, `game picture of ${n}`])),
      // the game has portraits for its heroes and for nothing else
      heroPortraits: async (ids: string[]) => Object.fromEntries(ids.filter((id) => ['antimage', 'axe'].includes(id)).map((id) => [id, `portrait of ${id}`])),
      size: () => 10, clear: () => asked.push('game icons cleared'),
    },
    icons: { getMany: async (names: string[]) => Object.fromEntries(names.map((n) => [n, `wiki picture of ${n}`])) },
    toolchain: {
      state: () => [{ name: 'vrf', installed: false }],
      ensure: async (name: string) => { if (name === 'broken') throw new Error('download failed'); },
      remove: (name: string) => asked.push(`remove ${name}`),
    },
    ...over,
  };
  const channels = registerAgainst(() => registerGameIpc(ctx as never));
  const call = (ch: string, ...args: unknown[]) => channels.get(ch)!({}, ...args);
  return {
    call, said, asked, settingsData,
    switchOff: (f: string | null) => { switchedOff = f; },
    running: (r: boolean) => { running = r; },
    setRepair: (r: Repair) => { repair = r; },
  };
}

test('the patch goes on only with a game path, with Dota closed and while cosmetics are not switched off; off is always allowed', async () => {
  const s = stand();
  s.switchOff('cosmetics');
  assert.deepEqual(await s.call('patch:setEnabled', true), { error: 'cosmetics is off today', blocked: true });
  assert.deepEqual(await s.call('patch:setEnabled', false), { ok: true }, 'a switch that traps people is worse than the problem');
  s.switchOff(null);

  s.running(true);
  assert.deepEqual(await s.call('patch:setEnabled', true), { error: say('Закрой Dota 2 перед изменением файлов игры') });
  s.running(false);

  s.settingsData.dotaGamePath = null;
  assert.deepEqual(await s.call('patch:setEnabled', true), { error: say('Путь к Dota 2 не задан') });
  assert.deepEqual(s.asked, ['patch false'], 'nothing reached the game while it was refused');
});

test('a patch switch that fails comes back as the reason', async () => {
  const s = stand({ schemaService: { setEnabled: () => { throw new Error('gameinfo is read-only'); } } });
  assert.deepEqual(await s.call('patch:setEnabled', true), { error: 'gameinfo is read-only' });
});

test('the repair banner goes away once read, but not while the repair is still waiting', async () => {
  const s = stand();
  s.setRepair({ state: 'waiting' });
  assert.deepEqual(await s.call('patch:repairSeen'), { state: 'waiting' });
  s.setRepair({ state: 'failed' });
  assert.deepEqual(await s.call('patch:repairSeen'), { state: 'idle' });
  assert.deepEqual(await s.call('patch:repairNow'), { state: 'done' });
  assert.deepEqual(s.asked, ['repair manual']);
});

test('a notice marked as seen is remembered, and the list keeps only the last fifty', async () => {
  const s = stand();
  s.settingsData.seenNotices = Array.from({ length: 50 }, (_, i) => `old-${i}`);
  const seen = await s.call('config:noticeSeen', 'new');
  assert.equal(seen.at(-1), 'new');
  assert.equal((s.settingsData.seenNotices as string[]).length, 50);
  assert.ok(!(s.settingsData.seenNotices as string[]).includes('old-0'), 'the oldest falls off');
});

test('a picture comes from the first source in its chain that has one: the mod, then the game, then the wiki', async () => {
  const s = stand();
  const r = await s.call('cosmetics:icons', ['modart:has.vpk|hero:Lina', 'modart:none.vpk|game-item', 'modart:none.vpk|Some Item', 'modvid:clip.vpk|hero:Axe']);
  assert.deepEqual(r.pictures, {
    'modart:has.vpk|hero:Lina': 'art of modart:has.vpk',
    'modart:none.vpk|game-item': 'game picture of game-item',
    'modart:none.vpk|Some Item': 'wiki picture of Some Item',
    'modvid:clip.vpk|hero:Axe': 'wiki picture of hero:Axe',
  });
  assert.deepEqual(r.decode, ['modvid:clip.vpk'], 'a clip with no frame yet is worth decoding in the window');
});

test('when the mod previews or the game pictures fail, the next source still answers and the log says why', async () => {
  const s = stand({
    modPreviews: { VID: 'modvid:', ART: 'modart:', TEX: 'modtex:', getMany: async () => { throw new Error('vrf crashed'); }, hasVideo: () => false },
    gameIcons: { getMany: async () => { throw new Error('pak01 unreadable'); } },
  });
  const r = await s.call('cosmetics:icons', ['modart:has.vpk|game-item']);
  assert.deepEqual(r.pictures, { 'modart:has.vpk|game-item': 'wiki picture of game-item' });
  assert.ok(s.said.some((m) => m.includes('vrf crashed')));
  assert.ok(s.said.some((m) => m.includes('pak01 unreadable')));
});

test('hero portraits asked for by the catalog\'s name come back under that name, and a name the game does not know is left out', async () => {
  const s = stand();
  const r = await s.call('cosmetics:heroPortraitsByName', ['Anti-Mage', 'Nobody At All', 42]);
  assert.deepEqual(Object.keys(r), ['Anti-Mage']);
  assert.equal(r['Anti-Mage'], 'portrait of antimage', 'under the id the game files it by');

  const broken = stand({ gameIcons: { heroPortraits: async () => { throw new Error('no game'); } } });
  assert.deepEqual(await broken.call('cosmetics:heroPortraitsByName', ['Anti-Mage']), {});
  assert.deepEqual(await broken.call('cosmetics:heroPortraits', ['axe']), {});
  assert.equal(broken.said.length, 2);
});

test('a preview clip or frame that fails is nothing, not an error in the window', async () => {
  const fine = stand();
  assert.deepEqual(await fine.call('preview:video', 'modvid:clip.vpk'), Buffer.from('webm'));
  assert.equal(await fine.call('preview:frame', 'modvid:clip.vpk', [1, 2, 3]), 'data:image/png;base64,AA==');
  const s = stand({
    modPreviews: { videoBytes: () => { throw new Error('index unreadable'); }, saveFrame: () => { throw new Error('disk full'); } },
  });
  assert.equal(await s.call('preview:video', 'modvid:clip.vpk'), null);
  assert.equal(await s.call('preview:frame', 'modvid:clip.vpk', null), null);
  assert.equal(s.said.length, 2);
});

test('a tool that fails to install says why, and removing the toolchain clears the pictures only it could make', async () => {
  const s = stand();
  assert.deepEqual(await s.call('tools:install', 'broken'), { error: 'download failed' });
  assert.equal((await s.call('tools:install')).ok, true);
  await s.call('tools:remove');
  assert.deepEqual(s.asked, ['remove vrf', 'game icons cleared', 'previews cleared']);
  assert.equal((await s.call('tools:state')).iconCacheBytes, 30);
});

test('a cosmetic pick or a whole set is refused while cosmetics are switched off, and a failure is the reason', async () => {
  const s = stand();
  assert.deepEqual(await s.call('cosmetics:pick', 'weapon', '42', 'Sword', ''), { ok: true, record: { id: 'weapon:42' } });
  assert.deepEqual(await s.call('cosmetics:pickSet', 'set-7'), { ok: true, records: ['set-7'] });
  s.switchOff('cosmetics');
  assert.equal((await s.call('cosmetics:pick', 'weapon', '42', 'Sword', '')).blocked, true);
  assert.equal((await s.call('cosmetics:pickSet', 'set-7')).blocked, true);
  const broken = stand({ schemaService: { pickCosmetic: () => { throw new Error('no donor'); }, pickSet: () => { throw new Error('no set'); } } });
  assert.deepEqual(await broken.call('cosmetics:pick', 'weapon', '42', 'Sword', ''), { error: 'no donor' });
  assert.deepEqual(await broken.call('cosmetics:pickSet', 'x'), { error: 'no set' });
});

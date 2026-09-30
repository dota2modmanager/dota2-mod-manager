/* The settings channels (src/ipc-settings.ts): where the game is, the Discord account, and the
 * language the main process speaks.
 *
 * The folder picker is the part people get wrong. Steam's folder is "dota 2 beta" and the one the
 * app needs is "game" inside it, so a pick of the outer folder is taken to mean the inner one, and
 * a folder with no Dota in it is refused with a sentence rather than saved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { registerSettingsIpc } from '../src/ipc-settings.ts';
import { getLang, setLang } from '../src/i18n.ts';
import { registerAgainst } from './helpers/fake-electron.ts';

const BETA = path.join('C:', 'Steam', 'steamapps', 'common', 'dota 2 beta');
const GAME = path.join(BETA, 'game');

function stand({ picked = [] as string[], signIn = async () => ({ id: '1', username: 'misha' }) as unknown } = {}) {
  const store = new Map<string, unknown>();
  const log: string[] = [];
  const window = { isDestroyed: () => false, show: () => log.push('show'), focus: () => log.push('focus') };
  const channels = registerAgainst(() => registerSettingsIpc({
    applyPresenceSetting: () => log.push('presence setting'),
    catalog: { load: async () => ({}) },
    discordAuth: { signIn },
    findDotaGamePath: async () => GAME,
    library: {},
    moveLangFolder: () => 0,
    presence: {},
    refreshPresence: () => log.push('presence'),
    remoteConfig: { beta: () => null },
    settings: { get: (k: string) => store.get(k), set: (k: string, v: unknown) => { store.set(k, v); } },
    settingsView: () => ({ view: true }),
    validateGamePath: (p: string) => p === GAME,
    langFolder: () => 'dota_russian',
    patchWatcher: () => ({ rearm: () => log.push('rearm') }),
    setPresenceView: (v: string) => log.push(`view ${v}`),
    updater: () => ({ recheck: () => log.push('recheck') }),
    win: () => window,
  } as never), {
    dialog: { showOpenDialog: async () => ({ canceled: picked.length === 0, filePaths: picked }) },
  });
  const call = (channel: string, ...args: unknown[]) => channels.get(channel)!({}, ...args);
  return { call, store, log };
}

test('picking the Steam folder instead of game inside it is taken to mean game', async () => {
  const s = stand({ picked: [BETA] });
  assert.deepEqual(await s.call('settings:browseDota'), { path: GAME });
  assert.equal(s.store.get('dotaGamePath'), GAME);
  assert.ok(s.log.includes('rearm'), 'the patch watcher lets go of the old folder');
});

test('a folder with no Dota in it is refused and not saved', async () => {
  const s = stand({ picked: [path.join('C:', 'Games')] });
  assert.ok((await s.call('settings:browseDota')).error);
  assert.equal(s.store.has('dotaGamePath'), false);
});

test('closing the folder picker changes nothing', async () => {
  const s = stand();
  assert.equal(await s.call('settings:browseDota'), null);
  assert.equal(s.store.has('dotaGamePath'), false);
});

test('finding the game by itself saves it and moves the watcher there', async () => {
  const s = stand();
  assert.equal(await s.call('settings:detectDota'), GAME);
  assert.equal(s.store.get('dotaGamePath'), GAME);
  assert.ok(s.log.includes('rearm'));
});

test('signing in keeps the account and brings the window back from behind the browser', async () => {
  const s = stand();
  const r = await s.call('account:signIn');
  assert.equal(r.ok, true);
  assert.deepEqual(s.store.get('account'), { id: '1', username: 'misha' });
  assert.deepEqual(s.log, ['show', 'focus']);
});

test('a sign-in that fails says why and keeps no account', async () => {
  const s = stand({ signIn: async () => { throw new Error('the browser was closed'); } });
  assert.deepEqual(await s.call('account:signIn'), { error: 'the browser was closed' });
  assert.equal(s.store.has('account'), false);
});

test('signing out asks the updater again, since the beta list no longer applies', async () => {
  const s = stand();
  s.store.set('account', { id: '1', username: 'misha' });
  assert.deepEqual(await s.call('account:signOut'), { ok: true });
  assert.equal(s.store.get('account'), null);
  assert.ok(s.log.includes('recheck'));
});

test('changing the interface language changes the main process\'s too, and redraws the status', async (t) => {
  const before = getLang();
  t.after(() => setLang(before));
  const s = stand();
  assert.deepEqual(await s.call('settings:set', 'uiLang', 'en'), { view: true }, 'answers with the whole view');
  assert.equal(getLang(), 'en');
  assert.ok(s.log.includes('presence setting'));
  await s.call('settings:set', 'theme', 'dark');
  assert.equal(s.log.filter((l) => l === 'presence setting').length, 1, 'other keys leave the status alone');
});

test('the tab the window reports is passed on, and a nonsense one reads as the catalog', async () => {
  const s = stand();
  await s.call('presence:view', 'library');
  await s.call('presence:view', 42);
  assert.deepEqual(s.log, ['view library', 'presence', 'view catalog', 'presence']);
});

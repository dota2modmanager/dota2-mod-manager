/* Where an installed copy looks for a new version.
 *
 * This used to live in main.js, where it could only be tested by releasing something. Two things
 * it decides are worth holding: that a copy on the stable channel is never offered a prerelease,
 * and that the mirror is tried after GitHub fails rather than settled into.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createUpdater, mirrorFor, MIRROR, EVERY, type UpdaterLike, type UpdateNews } from '../src/updater.ts';

/** A stand-in for electron-updater that records what it was told. */
function fake() {
  const on = new Map<string, (arg: never) => void>();
  const feeds: Record<string, unknown>[] = [];
  let checks = 0;
  const api: UpdaterLike = {
    channel: null,
    allowPrerelease: false,
    autoDownload: false,
    on: (evt: string, fn: (arg: never) => void) => on.set(evt, fn),
    setFeedURL: (feed) => { feeds.push(feed); },
    checkForUpdates: async () => { checks += 1; },
  };
  return {
    api,
    feeds,
    fire: (evt: string, arg?: unknown) => (on.get(evt) as ((a: unknown) => void) | undefined)?.(arg),
    checks: () => checks,
    knows: (evt: string) => on.has(evt),
  };
}

const build = (f: ReturnType<typeof fake>, over: Partial<Parameters<typeof createUpdater>[0]> = {}) => createUpdater({
  autoUpdater: f.api, channel: () => 'latest', every: () => {}, ...over,
});

test('a copy on the stable channel is never offered a prerelease', () => {
  const f = fake();
  build(f).start();

  assert.equal(f.api.channel, 'latest');
  assert.equal(f.api.allowPrerelease, false, 'a beta on GitHub is a prerelease; the stable channel must not see it');
  assert.deepEqual(f.feeds, [{ provider: 'github', owner: 'dota2modmanager', repo: 'dota2-mod-manager' }]);
  assert.equal(f.checks(), 1);
});

test('a tester reads the beta manifest, and prereleases are allowed for them', () => {
  const f = fake();
  build(f, { channel: () => 'beta' }).start();

  assert.equal(f.api.channel, 'beta');
  assert.equal(f.api.allowPrerelease, true);
});

test('the mirror is tried when GitHub fails, once, and carries both channels', () => {
  // one address: electron-updater asks for latest.yml or beta.yml by itself
  for (const [channel, url] of [['latest', MIRROR], ['beta', MIRROR]]) {
    const f = fake();
    const u = build(f, { channel: () => channel });
    u.start();
    f.fire('error', new Error('getaddrinfo ENOTFOUND github.com'));

    assert.deepEqual(f.feeds[1], { provider: 'generic', url }, `${channel}: the second try is the mirror`);
    assert.equal(f.checks(), 2);
    assert.match(u.lastError() ?? '', /ENOTFOUND/, 'the reason is remembered, because "it never updates" is a support question');

    f.fire('error', new Error('and again'));
    assert.equal(f.feeds.length, 2, 'the mirror is not re-pointed at itself on every error');
    assert.equal(f.checks(), 2);
  }
  assert.equal(mirrorFor(), MIRROR, 'the beta manifest lives beside the release one');
});

test('looking again starts at GitHub, and re-reads which channel this copy is on', () => {
  const f = fake();
  let channel = 'latest';
  const u = build(f, { channel: () => channel });
  u.start();
  f.fire('error', new Error('down'));
  assert.equal(f.feeds.length, 2, 'on the mirror now');

  channel = 'beta'; // the switch was flipped, or the signed list changed
  assert.equal(u.recheck(), 'beta');
  assert.deepEqual(f.feeds[2], { provider: 'github', owner: 'dota2modmanager', repo: 'dota2-mod-manager' });
  assert.equal(f.api.channel, 'beta');
  assert.equal(f.checks(), 3);
});

test('a portable copy is told about an update rather than handed one', () => {
  const sent: UpdateNews[] = [];
  const f = fake();
  const u = build(f, { isPortable: true, send: (evt) => { sent.push(evt); } });
  u.start();

  assert.equal(f.api.autoDownload, false, 'a portable build has no installer to hand the download to');
  f.fire('update-available', { version: '2.7.0' });
  assert.deepEqual(sent, [{ type: 'portable', version: '2.7.0' }]);
  assert.equal(u.portableVersion(), '2.7.0', 'and the version is kept, so the download button has something to ask for');
});

test('an installed copy downloads by itself and says when it is ready', () => {
  const sent: UpdateNews[] = [];
  const f = fake();
  const u = build(f, { send: (evt) => { sent.push(evt); } });
  u.start();

  assert.equal(f.api.autoDownload, true);
  f.fire('update-available', { version: '2.7.0' });
  f.fire('update-downloaded', { version: '2.7.0' });
  assert.deepEqual(sent, [{ type: 'available', version: '2.7.0' }, { type: 'downloaded', version: '2.7.0' }]);
  assert.equal(u.portableVersion(), null);
});

test('the four-hourly round is handed to the timer the way a timer takes it', () => {
  /* The call reads every(EVERY, fn); setInterval takes them the other way round. Passing it
     through as the default threw ERR_INVALID_ARG_TYPE in the built app and nowhere else,
     because every other test here hands in a stand-in. */
  const real = globalThis.setInterval;
  const scheduled: [string, number | undefined][] = [];
  globalThis.setInterval = ((fn: unknown, ms?: number) => { scheduled.push([typeof fn, ms]); return 0; }) as unknown as typeof setInterval;
  try {
    createUpdater({ autoUpdater: fake().api }).start(); // no `every`: the production path
  } finally {
    globalThis.setInterval = real;
  }

  assert.deepEqual(scheduled, [['function', EVERY]]);
});

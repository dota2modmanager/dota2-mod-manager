/* The catalog's download counter (src/download-stats.ts): the keys an install counts under, and the
 * promise that matters more than the numbers, that nothing the counter does or fails to do can
 * reach an install. A dead Worker, a hung one, garbage in downloads.json: each is an empty or old
 * number on a card, never an error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildToken, catalogModsReader, createDownloadStats, statKey, statKeysFor, statStyleName } from '../src/download-stats.ts';
import { sortMods } from '../renderer/catalog/filters.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mm-stats-'));

const MODS = {
  heroes: [
    { name: 'Bare Brewmaster' },
    { name: 'Spectre Arcana', styles: [{ label: 'Style I' }, { label: 'Style II' }] },
    { name: 'One Look', styles: [{ label: 'Style I' }] },
  ],
  'creep-deny': { groups: [{ id: 'deny', mods: [{ name: 'Huh Deny' }] }, { id: 'last-hit', mods: [{ name: 'Bonk' }] }] },
};

test('keys are written the way the counter and the catalog site write them', () => {
  assert.equal(statKey('heroes', null, 'Bare Brewmaster'), 'heroes/Bare Brewmaster');
  assert.equal(statKey('creep-deny', 'deny', 'Huh Deny', 'II'), 'creep-deny/deny/Huh Deny/II');
  assert.equal(statStyleName('Style II'), 'II');
  assert.equal(statStyleName('  '), 'Default');
  assert.equal(statStyleName(null), 'Default');
});

test('an install counts under its group, and a look only for a mod that has several', () => {
  assert.deepEqual(statKeysFor(MODS, 'heroes', 'Bare Brewmaster', null), ['heroes/Bare Brewmaster']);
  assert.deepEqual(statKeysFor(MODS, 'creep-deny', 'Bonk', null), ['creep-deny/last-hit/Bonk']);
  // the look and the mod's total both
  assert.deepEqual(statKeysFor(MODS, 'heroes', 'Spectre Arcana', 'Style II'), ['heroes/Spectre Arcana/II', 'heroes/Spectre Arcana']);
  assert.deepEqual(statKeysFor(MODS, 'heroes', 'One Look', 'Style I'), ['heroes/One Look']);
  // what the catalog does not list is not sent at all
  assert.deepEqual(statKeysFor(MODS, 'heroes', 'My own vpk', null), []);
  assert.deepEqual(statKeysFor(MODS, 'nowhere', 'x', null), []);
  assert.deepEqual(statKeysFor(null, 'heroes', 'x', null), []);
});

type Call = { url: string; init: RequestInit };
function fakeFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return answer(url, init); }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

test('a preset of many installs leaves as one request, each key capped, with the token', async () => {
  const dir = tmp();
  const f = fakeFetch(() => new Response('', { status: 204 }));
  const stats = createDownloadStats({ cacheFile: path.join(dir, 'c.json'), enabled: () => true, token: () => 't'.repeat(64), fetch: f.fn });
  for (let i = 0; i < 9; i++) stats.track(['heroes/Bare Brewmaster']);
  stats.track(['heroes/Spectre Arcana/II', 'heroes/Spectre Arcana']);
  await stats.flush();
  const hits = f.calls.filter((c) => c.url.endsWith('/hit'));
  assert.equal(hits.length, 1);
  assert.deepEqual(JSON.parse(String(hits[0].init.body)).hits, { 'heroes/Bare Brewmaster': 5, 'heroes/Spectre Arcana/II': 1, 'heroes/Spectre Arcana': 1 });
  assert.equal((hits[0].init.headers as Record<string, string>)['X-App-Token'], 't'.repeat(64));
  // nothing left over for a second request
  await stats.flush();
  assert.equal(f.calls.filter((c) => c.url.endsWith('/hit')).length, 1);
});

test('no token, or counting switched off, sends nothing at all', async () => {
  for (const [token, enabled] of [[null, true], ['t'.repeat(64), false]] as const) {
    const f = fakeFetch(() => json({}));
    const stats = createDownloadStats({ cacheFile: path.join(tmp(), 'c.json'), enabled: () => enabled, token: () => token, fetch: f.fn });
    stats.track(['heroes/Bare Brewmaster']);
    await stats.flush();
    assert.equal(f.calls.length, 0);
  }
});

test('a counter that is down or throws costs nothing: the hit is dropped and nothing is thrown', async () => {
  const f = fakeFetch(() => { throw new TypeError('fetch failed'); });
  const logged: string[] = [];
  const stats = createDownloadStats({ cacheFile: path.join(tmp(), 'c.json'), enabled: () => true, token: () => 't'.repeat(64), fetch: f.fn, log: (m) => logged.push(m) });
  stats.track(['heroes/Bare Brewmaster']);
  await stats.flush();
  assert.deepEqual(await stats.get(), { 'heroes/Bare Brewmaster': 1 }); // this run's install still shows
  assert.ok(logged.some((m) => /fetch failed/.test(m)));
  // dropped, not retried
  const before = f.calls.length;
  await stats.flush();
  assert.equal(f.calls.length, before);
});

test('counts come from the last good copy on disk when the counter cannot be reached', async () => {
  const dir = tmp();
  const cacheFile = path.join(dir, 'c.json');
  const up = createDownloadStats({ cacheFile, enabled: () => true, token: () => null, fetch: fakeFetch(() => json({ 'heroes/Bare Brewmaster': 100, junk: 'x', neg: -3 })).fn });
  assert.deepEqual(await up.get(), { 'heroes/Bare Brewmaster': 100 });

  const down = createDownloadStats({ cacheFile, enabled: () => true, token: () => null, fetch: fakeFetch(() => new Response('', { status: 503 })).fn });
  assert.deepEqual(await down.get(), { 'heroes/Bare Brewmaster': 100 });
  // something that is not a map of counts does not replace good numbers either
  const garbage = createDownloadStats({ cacheFile, enabled: () => true, token: () => null, fetch: fakeFetch(() => json([1, 2, 3])).fn });
  assert.deepEqual(await garbage.get(), { 'heroes/Bare Brewmaster': 100 });
});

test('downloads.json is asked for once in a while, not on every card', async () => {
  let t = 0;
  const f = fakeFetch(() => json({ a: 1 }));
  const stats = createDownloadStats({ cacheFile: path.join(tmp(), 'c.json'), enabled: () => true, token: () => null, fetch: f.fn, now: () => t });
  await Promise.all([stats.get(), stats.get(), stats.get()]);
  await stats.get();
  assert.equal(f.calls.length, 1);
  t += 6 * 60 * 1000;
  await stats.get();
  assert.equal(f.calls.length, 2);
});

test('the build token is read only when it looks like one', () => {
  const dir = tmp();
  const file = path.join(dir, 'download-stats.token');
  assert.equal(buildToken(file), null); // a source checkout has none
  fs.writeFileSync(file, `${'a'.repeat(64)}\n`);
  assert.equal(buildToken(file), 'a'.repeat(64));
  fs.writeFileSync(file, 'PASTE YOUR TOKEN');
  assert.equal(buildToken(file), null);
});

test('the catalog is read from its cache file, again only when the file changes', () => {
  const dir = tmp();
  const file = path.join(dir, 'mods.json');
  const read = catalogModsReader(file);
  assert.equal(read(), null);
  fs.writeFileSync(file, JSON.stringify({ modsData: MODS }));
  assert.deepEqual(statKeysFor(read(), 'creep-deny', 'Huh Deny', null), ['creep-deny/deny/Huh Deny']);
});

test('"most downloaded first" keeps the catalog order among mods with the same count', () => {
  const list = ['a', 'b', 'c', 'd'];
  const n: Record<string, number> = { a: 0, b: 7, c: 0, d: 30 };
  assert.deepEqual(sortMods(list, 'popular', (x) => x, () => 0, (x) => n[x]), ['d', 'b', 'a', 'c']);
});

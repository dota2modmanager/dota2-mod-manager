/* The star count on Home (src/repo-stars.ts): asked at most every six hours, kept across starts,
 * and never an error: a dead network or a strange answer leaves the last number, or none. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRepoStars } from '../src/repo-stars.ts';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-stars-')), 'repo-stars.json');
const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

test('the count is asked once, kept on disk, and the next start has it without asking', async () => {
  const cacheFile = tmp();
  let asked = 0;
  const fetch = (async (...a: Parameters<typeof globalThis.fetch>) => { asked++; return answer({ stargazers_count: 41 })(...a); }) as typeof globalThis.fetch;
  const stars = createRepoStars({ cacheFile, fetch, now: () => 1000 });
  assert.equal(await stars.get(), 41);
  assert.equal(await stars.get(), 41);
  assert.equal(asked, 1);
  const next = createRepoStars({ cacheFile, fetch: answer({}, false), now: () => 2000 });
  assert.equal(await next.get(), 41);
});

test('after six hours it asks again, and a failed answer keeps the last number', async () => {
  const cacheFile = tmp();
  let t = 0;
  await createRepoStars({ cacheFile, fetch: answer({ stargazers_count: 7 }), now: () => t }).get();
  t = 7 * 60 * 60 * 1000;
  assert.equal(await createRepoStars({ cacheFile, fetch: answer({ stargazers_count: 9 }), now: () => t }).get(), 9);
  t *= 2;
  const dead = (async () => { throw new Error('offline'); }) as typeof globalThis.fetch;
  assert.equal(await createRepoStars({ cacheFile, fetch: dead, now: () => t }).get(), 9);
  assert.equal(await createRepoStars({ cacheFile, fetch: answer({ stargazers_count: 'many' }), now: () => t }).get(), 9);
});

test('with nothing cached and no network the count is null, not an error', async () => {
  const dead = (async () => { throw new Error('offline'); }) as typeof globalThis.fetch;
  assert.equal(await createRepoStars({ cacheFile: tmp(), fetch: dead }).get(), null);
});

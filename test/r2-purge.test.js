/* Dropping replaced objects out of the cache in front of the bucket.
 *
 * Writing a new object into R2 does not change what Cloudflare already handed somebody, and
 * .zip and .vpk are cached by default. On 2026-09-10 one of twenty-three refreshed archives
 * was still being served in its 28 August form more than an hour after the object under it had
 * changed - and before that day's fix, that copy was enough to stop the mod installing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { purgeCache } = require('../tools/r2-client.js');

/** Stands in for the Cloudflare API and records what it was asked to drop. */
function api({ ok = true, errors = [] } = {}) {
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.authorization });
    return {
      ok,
      status: ok ? 200 : 403,
      json: async () => ({ success: ok, errors }),
    };
  };
  return { calls, restore: () => { global.fetch = real; } };
}

const env = { CLOUDFLARE_ZONE_ID: 'zone123', CLOUDFLARE_PURGE_TOKEN: 'tok' };
const quiet = () => {};

test('nothing to purge asks nobody anything', async (t) => {
  const cf = api();
  t.after(cf.restore);
  assert.deepEqual(await purgeCache([], { env, log: quiet }), { purged: 0 });
  assert.equal(cf.calls.length, 0);
});

test('the replaced urls go to the zone, once each', async (t) => {
  const cf = api();
  t.after(cf.restore);
  const urls = ['https://cdn.example/a.zip', 'https://cdn.example/b.vpk', 'https://cdn.example/a.zip'];

  const out = await purgeCache(urls, { env, log: quiet });

  assert.equal(out.purged, 2, 'the repeat is not sent twice');
  assert.equal(cf.calls.length, 1);
  assert.match(cf.calls[0].url, /zones\/zone123\/purge_cache$/);
  assert.equal(cf.calls[0].auth, 'Bearer tok');
  assert.deepEqual(cf.calls[0].body.files, ['https://cdn.example/a.zip', 'https://cdn.example/b.vpk']);
});

test('more than thirty go in batches, because that is the limit the API takes', async (t) => {
  const cf = api();
  t.after(cf.restore);
  const urls = Array.from({ length: 71 }, (_, i) => `https://cdn.example/${i}.zip`);

  const out = await purgeCache(urls, { env, log: quiet });

  assert.equal(out.purged, 71);
  assert.deepEqual(cf.calls.map((c) => c.body.files.length), [30, 30, 11]);
});

test('no credentials says so and does not pretend it purged anything', async (t) => {
  const cf = api();
  t.after(cf.restore);
  const said = [];

  const out = await purgeCache(['https://cdn.example/a.zip'], { env: {}, log: (m) => said.push(m) });

  assert.deepEqual(out, { purged: 0, skipped: 'no credentials' });
  assert.equal(cf.calls.length, 0, 'and it did not call the API without a token');
  assert.match(said.join(' '), /CLOUDFLARE_ZONE_ID/, 'the operator is told what is missing');
});

test('a refused purge is reported, not thrown', async (t) => {
  // the sync has already copied everything correctly at this point; a cache is not worth
  // turning a good run into a failed one
  const cf = api({ ok: false, errors: [{ message: 'Actor is not authorized' }] });
  t.after(cf.restore);
  const said = [];

  const out = await purgeCache(['https://cdn.example/a.zip'], { env, log: (m) => said.push(m) });

  assert.equal(out.purged, 0);
  assert.equal(out.failed, 1, 'a refusal is counted, so the job can fail on it instead of staying green');
  assert.match(said.join(' '), /Actor is not authorized/);
});

test('the API throwing is reported, not thrown', async (t) => {
  const real = global.fetch;
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  t.after(() => { global.fetch = real; });
  const said = [];

  const out = await purgeCache(['https://cdn.example/a.zip'], { env, log: (m) => said.push(m) });

  assert.equal(out.purged, 0);
  assert.equal(out.failed, 1);
  assert.match(said.join(' '), /ENOTFOUND/);
});

test('the mirror job fails when it replaced files it could not purge', () => {
  /* The purge had never run: CLOUDFLARE_ZONE_ID was not set, purgeCache said so in one log line,
     and the job stayed green while replaced archives kept being served from cache. */
  const sync = require('fs').readFileSync(require('path').join(__dirname, '..', 'tools', 'r2-sync.mjs'), 'utf8');
  assert.match(sync, /const purge = await purgeCache\(replaced\)/, 'r2-sync no longer keeps the purge result');
  assert.match(sync, /replaced\.length && purge && \(purge\.skipped \|\| purge\.failed\)\)[\s\S]{0,400}process\.exitCode = 1/, 'a skipped or refused purge after replacing files no longer fails the job');
});

test('the site token alone is enough, which is what the mirror job passes', async (t) => {
  const cf = api();
  t.after(cf.restore);
  const out = await purgeCache(['https://cdn.example/a.zip'], { env: { CLOUDFLARE_ZONE_ID: 'zone123', CLOUDFLARE_API_TOKEN: 'site-token' }, log: quiet });
  assert.equal(out.purged, 1);
  assert.equal(cf.calls[0].auth, 'Bearer site-token');
});

test('the mirror job is handed a zone and a token, so the purge cannot be skipped by omission', () => {
  /* Both used to be secrets nobody had set. The zone id is an identifier and is written into the
     workflow; the token is the one already set for the site. */
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'workflows', 'r2.yml'), 'utf8').replace(/\r\n/g, '\n');
  const step = /- name: Copy what is missing\n([\s\S]*?)\n\s*run:/.exec(yml);
  assert.ok(step, 'r2.yml has no "Copy what is missing" step');
  assert.match(step[1], /CLOUDFLARE_ZONE_ID: [0-9a-f]{32}\n/, 'the step has no zone id to purge in');
  assert.match(step[1], /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/, 'the step has no token to purge with');
});

test('the purge URLs use the address the app downloads from, not a secret that can go stale', () => {
  /* R2_PUBLIC_BASE was a secret, and on 2026-09-15 it held an address answering 401, so every purge
     URL named the wrong host. The address is written into r2-sync now. */
  const fs = require('fs');
  const path = require('path');
  const sync = fs.readFileSync(path.join(__dirname, '..', 'tools', 'r2-sync.mjs'), 'utf8');
  // Plain substring checks, not patterns: a regular expression with a host name in it reads to
  // CodeQL as URL validation missing its anchors, and it raised a high-severity alert on this test.
  const HOST = 'https://cdn.dota2modmanager.com';
  assert.ok(sync.includes(`const PUBLIC_BASE = '${HOST}';`), 'r2-sync no longer writes the public address in');
  assert.ok(!sync.includes('process.env.R2_PUBLIC_BASE'), 'r2-sync reads the public address from a secret again');
  const net = fs.readFileSync(path.join(__dirname, '..', 'src', 'net-mirrors.ts'), 'utf8');
  assert.ok(net.includes(HOST.replace('https://', '')), 'the app no longer downloads from the address the purge uses');
});

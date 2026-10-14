/* The daily check that every secret still works, against stand-ins for each service.
 *
 * The cases are the ways a secret stopped doing its job around 2026-09-15: a personal token that
 * expired, a Cloudflare token whose Pages permission was replaced while adding Cache Purge, a purge
 * that was refused and only logged, and a webhook nobody could tell was set.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const load = () => import('../tools/check-credentials.mjs');
const radar = () => import('../tools/radar.mjs');

/** Answers requests by matching "METHOD url" against patterns, and records what was asked. */
function service(routes) {
  const calls = [];
  const http = async (url, opts = {}) => {
    const key = `${opts.method || 'GET'} ${url}`;
    calls.push({ key, headers: opts.headers || {}, body: opts.body });
    for (const [pattern, reply] of routes) if (pattern.test(key)) return reply;
    return { status: 404, json: null };
  };
  return { http, calls };
}

const cfOk = { status: 200, json: { success: true, result: { status: 'active', expires_on: '2027-01-01T00:00:00Z' } } };
const good = { status: 200, json: { success: true, result: [] } };
const denied = { status: 403, json: { success: false, errors: [{ message: 'Authentication error' }] } };
const cfEnv = { CLOUDFLARE_API_TOKEN: 'cf-token-value', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_ZONE_ID: 'b1b7154350d99e0812859bbc6d775806' };

test('every secret in the registry has a check, so none can be added without one', async () => {
  const { CHECKS } = await load();
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'credentials.json'), 'utf8')).secrets;
  const unchecked = Object.keys(registry).filter((name) => typeof CHECKS[name] !== 'function');
  assert.deepEqual(unchecked, [], `listed in .github/credentials.json with no check in tools/check-credentials.mjs: ${unchecked.join(', ')}`);
});

test('a Cloudflare token that deploys and purges is ok, with the expiry Cloudflare reports', async () => {
  const { CHECKS } = await load();
  const cf = service([[/tokens\/verify$/, cfOk], [/pages\/projects$/, good], [/^POST .*purge_cache$/, good]]);
  const r = await CHECKS.CLOUDFLARE_API_TOKEN(cfEnv, { http: cf.http });
  assert.equal(r.state, 'ok');
  assert.equal(r.expires, '2027-01-01');
  assert.equal(cf.calls[0].headers.Authorization, 'Bearer cf-token-value');
});

test('the 2026-09-15 near miss: Cache Purge added in place of Pages is caught as a site that cannot deploy', async () => {
  const { CHECKS } = await load();
  const cf = service([[/tokens\/verify$/, cfOk], [/pages\/projects$/, denied], [/^POST .*purge_cache$/, good]]);
  const r = await CHECKS.CLOUDFLARE_API_TOKEN(cfEnv, { http: cf.http });
  assert.equal(r.state, 'failed');
  assert.match(r.detail, /site cannot be deployed/);
  assert.match(r.detail, /Cloudflare Pages, Edit/);
});

test('a token that cannot purge is caught too, and a rejected token says so', async () => {
  const { CHECKS } = await load();
  const noPurge = service([[/tokens\/verify$/, cfOk], [/pages\/projects$/, good], [/^POST .*purge_cache$/, denied]]);
  const r = await CHECKS.CLOUDFLARE_API_TOKEN(cfEnv, { http: noPurge.http });
  assert.equal(r.state, 'failed');
  assert.match(r.detail, /cannot purge the cache/);

  const rejected = service([[/tokens\/verify$/, { status: 401, json: { success: false } }]]);
  assert.match((await CHECKS.CLOUDFLARE_API_TOKEN(cfEnv, { http: rejected.http })).detail, /Cloudflare rejects the token/);
});

test('the GitLab token reports its own expiry, read from the token inside the push URL', async () => {
  const { CHECKS } = await load();
  const gl = service([[/personal_access_tokens\/self$/, { status: 200, json: { active: true, revoked: false, expires_at: '2027-09-09' } }]]);
  const r = await CHECKS.MIRROR_PUSH_URL({ MIRROR_PUSH_URL: 'https://oauth2:glpat-secret123@gitlab.com/x/y.git' }, { http: gl.http });
  assert.deepEqual(r, { state: 'ok', detail: 'active', expires: '2027-09-09' });
  assert.equal(gl.calls[0].headers['PRIVATE-TOKEN'], 'glpat-secret123');

  const revoked = service([[/personal_access_tokens\/self$/, { status: 200, json: { active: false, revoked: true } }]]);
  assert.equal((await CHECKS.MIRROR_PUSH_URL({ MIRROR_PUSH_URL: 'https://oauth2:glpat-secret123@gitlab.com/x/y.git' }, { http: revoked.http })).state, 'failed');
});

test('a deleted webhook, a missing secret and a refused deploy key are each named', async () => {
  const { CHECKS, REPO } = await load();
  const gone = service([]);
  assert.equal((await CHECKS.RADAR_DISCORD_WEBHOOK({ RADAR_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1/abc' }, { http: gone.http })).state, 'failed');
  const alive = service([[/webhooks/, { status: 200, json: { id: '1', name: 'Radar' } }]]);
  assert.equal((await CHECKS.RADAR_DISCORD_WEBHOOK({ RADAR_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/1/abc' }, { http: alive.http })).state, 'ok');

  assert.equal((await CHECKS.BING_API_KEY({}, { http: gone.http })).state, 'missing');

  const greeted = await CHECKS.FINGERPRINTS_DEPLOY_KEY({ FINGERPRINTS_DEPLOY_KEY: 'k' }, { ssh: async () => `Hi ${REPO}! You've successfully authenticated, but GitHub does not provide shell access.` });
  assert.equal(greeted.state, 'ok');
  const refused = await CHECKS.FINGERPRINTS_DEPLOY_KEY({ FINGERPRINTS_DEPLOY_KEY: 'k' }, { ssh: async () => 'git@github.com: Permission denied (publickey).' });
  assert.equal(refused.state, 'failed');
});

test('a check that throws is a failed secret, and no secret value survives into the detail', async () => {
  const { checkAll } = await load();
  const env = { BING_API_KEY: 'bing-key-1234567890' };
  const io = { http: async (url) => { throw new Error(`unexpected answer from ${url}?key=${env.BING_API_KEY}`); } };
  const results = await checkAll(['BING_API_KEY'], env, io);
  assert.equal(results.BING_API_KEY.state, 'failed');
  assert.doesNotMatch(results.BING_API_KEY.detail, /bing-key-1234567890/);
  assert.match(results.BING_API_KEY.detail, /\*\*\*/);
});

test('a service that never answers leaves the secret unchecked, not failed', async () => {
  /* Yandex Webmaster stopped answering GitHub's runners on 2026-10-11, and every morning the radar
     said, red, to issue a new token that had never been the problem. */
  const { checkAll } = await load();
  const env = { YANDEX_OAUTH_TOKEN: 'y-token-1234567890' };
  for (const err of [new TypeError('fetch failed'), Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), new Error('getaddrinfo ENOTFOUND api.webmaster.yandex.net')]) {
    const results = await checkAll(['YANDEX_OAUTH_TOKEN'], env, { http: async () => { throw err; } });
    assert.equal(results.YANDEX_OAUTH_TOKEN.state, 'unreachable', err.message);
    assert.match(results.YANDEX_OAUTH_TOKEN.detail, /did not answer/);
    assert.doesNotMatch(results.YANDEX_OAUTH_TOKEN.detail, /y-token-1234567890/);
  }
  // an answer that refuses the token is still the token's fault
  const refused = await checkAll(['YANDEX_OAUTH_TOKEN'], env, { http: async () => ({ status: 401, json: null, text: '' }) });
  assert.equal(refused.YANDEX_OAUTH_TOKEN.state, 'failed');
});

test('the zone id is read from r2.yml, where the purge that needs it runs', async () => {
  const { zoneIdFromWorkflow } = await load();
  assert.match(zoneIdFromWorkflow() || '', /^[0-9a-f]{32}$/);
  assert.equal(zoneIdFromWorkflow('nothing here'), null);
});

test('the radar turns live results into red lines, real dates and a working count', async () => {
  const { evaluate } = await radar();
  const NOW = Date.parse('2026-09-20T06:30:00Z');
  const credentials = {
    CLOUDFLARE_API_TOKEN: { what: 'site', kind: 'api-token', expires: 'unknown', rotate: 'roll it' },
    MIRROR_PUSH_URL: { what: 'mirror', kind: 'project-token', expires: '2027-09-09', rotate: 'gitlab' },
    R2_ACCESS_KEY_ID: { what: 'r2', kind: 'api-key', expires: 'unknown', rotate: 'cloudflare' },
  };
  const broken = evaluate({ credentials, credentialStatus: {
    CLOUDFLARE_API_TOKEN: { state: 'failed', detail: 'it cannot reach Cloudflare Pages' },
    MIRROR_PUSH_URL: { state: 'ok', detail: 'active', expires: '2026-09-25' },
    R2_ACCESS_KEY_ID: { state: 'missing', detail: 'not set' },
  } }, NOW);
  const red = broken.red.map((x) => x.title);
  assert.ok(red.includes('CLOUDFLARE_API_TOKEN no longer works'));
  assert.ok(red.includes('R2_ACCESS_KEY_ID is not set'));
  assert.ok(broken.expiring.some((x) => x.title === 'MIRROR_PUSH_URL expires on 2026-09-25'), 'the date GitLab reports wins over the typed one');
  assert.ok(broken.overdue.length >= 2);

  const healthy = evaluate({ credentials, credentialStatus: {
    CLOUDFLARE_API_TOKEN: { state: 'ok', detail: 'active' },
    MIRROR_PUSH_URL: { state: 'ok', detail: 'active', expires: '2027-09-09' },
    R2_ACCESS_KEY_ID: { state: 'ok', detail: 'lists the bucket' },
  } }, NOW);
  assert.equal(healthy.red.length, 0);
  assert.ok(healthy.fine.includes('3 of 3 secrets checked today and working'));
  assert.ok(!healthy.look.some((x) => /No expiry date recorded/.test(x.title)), 'a secret proven to work today is not a question to answer');
});

test('a working R2 key is ok whatever shape its listing comes back in, and a refusal says so', async () => {
  /* The first real run called three working R2 secrets broken: list() answers with a Map and the
     check wanted an array. Resolving at all is the proof, because list() throws on anything but 200. */
  const { checkR2 } = await load();
  const factory = (list) => () => ({ configured: true, list });
  assert.equal((await checkR2({}, factory(async () => new Map([['index.json', 120]])))).state, 'ok');
  assert.equal((await checkR2({}, factory(async () => new Map()))).state, 'ok', 'an empty listing is still a key that works');
  const refused = await checkR2({}, factory(async () => { throw new Error('list: HTTP 403 <Error><Code>AccessDenied</Code></Error>'); }));
  assert.equal(refused.state, 'failed');
  assert.match(refused.detail, /HTTP 403/);
  assert.equal((await checkR2({}, () => ({ configured: false }))).state, 'failed');
});

test('the VirusTotal key is read against a report only a key can read, and "not set" is not a failure', async () => {
  const { CHECKS } = await load();
  const vt = service([[/files\/44d88612fea8a8f36de82e1278abb02f$/, { status: 200, json: { data: {} } }]]);
  const good = await CHECKS.VIRUSTOTAL_API_KEY({ VIRUSTOTAL_API_KEY: 'vt-key' }, { http: vt.http });
  assert.equal(good.state, 'ok');
  assert.equal(vt.calls[0].headers['x-apikey'], 'vt-key');
  assert.equal(vt.calls[0].key.includes('vt-key'), false, 'the key stays in the header, never in the address');

  const revoked = service([[/files\//, { status: 401, json: null }]]);
  const bad = await CHECKS.VIRUSTOTAL_API_KEY({ VIRUSTOTAL_API_KEY: 'old' }, { http: revoked.http });
  assert.equal(bad.state, 'failed');
  assert.match(bad.detail, /revoked/);

  const none = await CHECKS.VIRUSTOTAL_API_KEY({}, { http: vt.http });
  assert.equal(none.state, 'missing');
});

test('a secret marked optional is a decision when it is not set, and a red line when it is not', async () => {
  /* The workflow that reads an optional key says so and skips, so a key nobody has created yet
     must not message the maintainer every morning. */
  const { evaluate } = await radar();
  const both = {
    VIRUSTOTAL_API_KEY: { what: 'the release report', kind: 'api-key', expires: 'never', optional: true, rotate: 'virustotal.com' },
    R2_ACCESS_KEY_ID: { what: 'the mirror', kind: 'api-key', expires: 'unknown', rotate: 'cloudflare' },
  };
  const status = { VIRUSTOTAL_API_KEY: { state: 'missing', detail: 'not set' }, R2_ACCESS_KEY_ID: { state: 'missing', detail: 'not set' } };
  const r = evaluate({ credentials: both, credentialStatus: status }, Date.parse('2026-09-22T06:30:00Z'));

  assert.deepEqual(r.decide.map((x) => x.title), ['VIRUSTOTAL_API_KEY is not set, and the job that reads it skips']);
  assert.deepEqual(r.red.map((x) => x.title), ['R2_ACCESS_KEY_ID is not set']);
  assert.deepEqual(r.overdue.map((x) => x.title), ['R2_ACCESS_KEY_ID is not set'], 'only the one nothing can work without');
});

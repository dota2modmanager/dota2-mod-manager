/* The community presets' worker and the index the workflow builds from what it writes.
 *
 * The worker is the only writer of the community-presets branch, so what it lets through is what
 * every app shows. These run it against a stand-in for GitHub's contents API and Discord's
 * /users/@me, and check the three things that matter: a preset is signed so the app can tell it
 * came from here, a person is one vote however often they press, and nobody can take down or vote
 * on somebody else's preset as its author.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const path = require('node:path');

const load = (f) => import(require('node:url').pathToFileURL(path.join(__dirname, '..', 'tools', 'ops', 'presets-worker', f)).href);

const DAY = 86400000;
/** A Discord id made at `ms` (a snowflake is a timestamp shifted left 22 bits). */
const snowflake = (ms) => String((BigInt(ms) - 1420070400000n) << 22n);

function keys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    signing: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey,
  };
}

const code = (mods) => zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: 1, n: 'x', m: mods })))
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** GitHub's contents API on one branch, and Discord, in memory. */
function world(accounts) {
  const files = new Map();
  let shas = 0;
  const dispatched = [];
  const real = global.fetch;
  const reply = (status, body) => new Response(JSON.stringify(body), { status });
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.host === 'discord.test') {
      const who = accounts[String(opts.headers?.authorization || '').replace('Bearer ', '')];
      return who ? reply(200, who) : reply(401, {});
    }
    if (u.pathname.endsWith('/dispatches')) { dispatched.push(u.pathname); return new Response(null, { status: 204 }); }
    const p = decodeURIComponent(u.pathname.split('/contents/')[1] || '');
    const method = opts.method || 'GET';
    if (method === 'GET') {
      if (files.has(p)) {
        const f = files.get(p);
        return reply(200, { sha: f.sha, content: Buffer.from(f.text).toString('base64') });
      }
      const inside = [...files.keys()].filter((k) => k.startsWith(`${p}/`));
      return inside.length ? reply(200, inside.map((k) => ({ type: 'file', name: k.slice(p.length + 1) }))) : reply(404, {});
    }
    const b = JSON.parse(opts.body);
    const cur = files.get(p);
    if ((cur?.sha || undefined) !== (b.sha || undefined)) return reply(409, {});
    if (method === 'PUT') files.set(p, { sha: `s${++shas}`, text: Buffer.from(b.content, 'base64').toString() });
    if (method === 'DELETE') files.delete(p);
    return reply(200, {});
  };
  return { files, dispatched, restore: () => { global.fetch = real; } };
}

async function setup(t) {
  const { default: worker } = await load('worker.mjs');
  const k = keys();
  const old = { id: snowflake(Date.now() - 400 * DAY), username: 'alice', global_name: 'Alice' };
  const other = { id: snowflake(Date.now() - 100 * DAY), username: 'bob' };
  const fresh = { id: snowflake(Date.now() - 2 * DAY), username: 'new' };
  const w = world({ A: old, B: other, N: fresh });
  t.after(w.restore);
  const env = {
    GITHUB_TOKEN: 'gh', SESSION_SECRET: 's'.repeat(32), USER_SECRET: 'u'.repeat(32), SIGNING_KEY: k.signing,
    GITHUB_API: 'https://gh.test', DISCORD_API: 'https://discord.test',
  };
  const call = async (method, p, body, session) => {
    const r = await worker.fetch(new Request(`https://presets.test${p}`, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: session ? { authorization: `Bearer ${session}` } : {},
    }), env);
    return { status: r.status, body: await r.json() };
  };
  const signIn = async (token) => (await call('POST', '/session', { discordToken: token })).body;
  return { w, k, call, signIn };
}

test('a published preset is signed, and its record is what the app will read', async (t) => {
  const { w, k, call, signIn } = await setup(t);
  const a = await signIn('A');
  assert.equal(a.user.name, 'Alice');
  assert.match(a.user.key, /^[0-9a-f]{16}$/);
  const c = code([['heroes', 'Some Mod'], ['$cos', 'weather', '555', 'Rain', '']]);
  const r = await call('POST', '/presets', { name: '  My\nbuild  ', about: 'line one\n\n\n\nline two', code: c }, a.session);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const file = JSON.parse(w.files.get(`presets/${r.body.id}.json`).text);
  assert.ok(crypto.verify(null, Buffer.from(file.record), k.publicKey, Buffer.from(file.sig, 'base64')), 'the signature checks against the public key');
  const rec = JSON.parse(file.record);
  assert.equal(rec.id, r.body.id);
  assert.equal(rec.name, 'My build');
  assert.equal(rec.about, 'line one\n\nline two');
  assert.equal(rec.code, c);
  assert.equal(rec.mods, 2);
  assert.deepEqual(rec.author, { key: a.user.key, name: 'Alice' });
  assert.ok(w.dispatched.length >= 1, 'the index is asked to rebuild');
});

test('a broken code, an empty name and a session that is not ours are refused', async (t) => {
  const { call, signIn } = await setup(t);
  const a = await signIn('A');
  assert.equal((await call('POST', '/presets', { name: 'x', code: 'not-a-code!' }, a.session)).status, 400);
  assert.equal((await call('POST', '/presets', { name: 'x', code: 'AAAA' }, a.session)).status, 400);
  assert.equal((await call('POST', '/presets', { name: '   ', code: code([['heroes', 'M']]) }, a.session)).status, 400);
  assert.equal((await call('POST', '/presets', { name: 'x', code: code([]) }, a.session)).status, 400);
  const forged = `${a.session.split('.')[0]}.${'A'.repeat(43)}`;
  assert.equal((await call('POST', '/presets', { name: 'x', code: code([['heroes', 'M']]) }, forged)).status, 401);
  assert.equal((await call('GET', '/me')).status, 401);
});

test('a Discord account made last week cannot sign in to vote', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('POST', '/session', { discordToken: 'N' })).status, 403);
  assert.equal((await call('POST', '/session', { discordToken: 'wrong' })).status, 401);
});

test('one account is one vote, never on its own preset, and it can be taken back', async (t) => {
  const { w, call, signIn } = await setup(t);
  const a = await signIn('A');
  const b = await signIn('B');
  const { body: { id } } = await call('POST', '/presets', { name: 'x', code: code([['heroes', 'M']]) }, a.session);
  assert.equal((await call('POST', '/votes', { id, value: 1 }, a.session)).status, 403, 'not on your own');
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/votes', { id, value: 1 }, b.session)).status, 200);
  assert.deepEqual(JSON.parse(w.files.get(`votes/${b.user.key}.json`).text), { [id]: 1 });
  assert.deepEqual((await call('GET', '/me', null, b.session)).body.votes, { [id]: 1 });
  await call('POST', '/votes', { id, value: -1 }, b.session);
  assert.deepEqual(JSON.parse(w.files.get(`votes/${b.user.key}.json`).text), { [id]: -1 });
  await call('POST', '/votes', { id, value: 0 }, b.session);
  assert.deepEqual(JSON.parse(w.files.get(`votes/${b.user.key}.json`).text), {});
  assert.equal((await call('POST', '/votes', { id: `${a.user.key}-zzzzzz`, value: 1 }, b.session)).status, 404);
  assert.equal((await call('POST', '/votes', { id, value: 5 }, b.session)).status, 400);
});

test('only the author takes a preset down', async (t) => {
  const { w, call, signIn } = await setup(t);
  const a = await signIn('A');
  const b = await signIn('B');
  const { body: { id } } = await call('POST', '/presets', { name: 'x', code: code([['heroes', 'M']]) }, a.session);
  assert.equal((await call('POST', '/unpublish', { id }, b.session)).status, 403);
  assert.ok(w.files.has(`presets/${id}.json`));
  assert.equal((await call('POST', '/unpublish', { id }, a.session)).status, 200);
  assert.ok(!w.files.has(`presets/${id}.json`));
});

test('the index counts votes, leaves out the hidden, the broken and the renamed, and is stable', async () => {
  const { buildIndex } = await load('index.mjs');
  const rec = (id, created) => ({ record: JSON.stringify({ id, created }), sig: 'S' });
  const a = 'aaaaaaaaaaaaaaaa-000001';
  const b = 'bbbbbbbbbbbbbbbb-000002';
  const hiddenId = 'cccccccccccccccc-000003';
  const input = {
    presets: {
      [a]: rec(a, '2026-11-01T00:00:00Z'),
      [b]: rec(b, '2026-11-02T00:00:00Z'),
      [hiddenId]: rec(hiddenId, '2026-11-03T00:00:00Z'),
      'dddddddddddddddd-000004': rec('eeeeeeeeeeeeeeee-000005', '2026-11-04T00:00:00Z'),
      'ffffffffffffffff-000006': { record: '{nope', sig: 'S' },
    },
    votes: {
      '1111111111111111': { [a]: 1, [b]: -1, [hiddenId]: 1, 'gone0000000000000-000000': 1 },
      '2222222222222222': { [a]: 1, [b]: 7 },
      aaaaaaaaaaaaaaaa: { [a]: 1 },
      'not-a-user': { [a]: 1 },
    },
    hidden: [hiddenId],
  };
  const index = buildIndex(input);
  assert.equal(index.version, 1);
  assert.deepEqual(index.presets.map((p) => [p.id, p.up, p.down]), [[b, 0, 1], [a, 2, 0]], 'newest first, own and bad votes skipped');
  assert.equal(index.presets[1].record, input.presets[a].record, 'the signed record goes through untouched');
  assert.equal(JSON.stringify(buildIndex(input)), JSON.stringify(index));
});

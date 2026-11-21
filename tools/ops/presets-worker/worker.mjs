/**
 * Community presets: people publish their presets and vote on each other's, and everything they
 * publish lives as JSON files in a branch of this repository. There is no database: this worker
 * holds nothing between requests. It is here only because a branch cannot be written to without
 * a key, and the key cannot ship in the app.
 *
 *   POST   /session      {discordToken}   who you are: Discord says, the worker signs a session
 *   GET    /me                            your account and your votes
 *   POST   /presets      {name, about, code}   publish a preset (its d2mm://preset/ code)
 *   POST   /unpublish    {id}             take your own preset down
 *   POST   /votes        {id, value}      1 like, -1 dislike, 0 take the vote back
 *
 * GET and POST only: the app's network layer (net_fetch.rs, direct) sends nothing else, and a
 * DELETE from it would arrive as a GET.
 *
 * The branch (BRANCH, created by .github/workflows/community-presets.yml on its first run):
 *
 *   presets/<id>.json   {record, sig}: record is the preset as a JSON string, sig its ed25519
 *                       signature by SIGNING_KEY. The app checks it against the public key it pins,
 *                       so a proxy between the app and GitHub cannot slip a preset in.
 *   votes/<user>.json   one person's votes, {"<preset id>": 1 | -1}
 *   hidden.json         ids a maintainer took down, kept out of the index
 *   index.json          everything the app reads, rebuilt by the workflow (index.mjs)
 *
 * Identity is a Discord account, the sign-in the app already has. The worker sees the Discord id
 * once, at /session, and keeps only a keyed hash of it (USER_SECRET): the same person is the same
 * key in every file, and nobody reading the branch learns their Discord id. Accounts younger than
 * MIN_ACCOUNT_DAYS cannot vote or publish, which is most of what a vote ring would be made of; one
 * account is one vote however many times it presses.
 *
 * A preset is a code, not files: catalog identities and looks from the game, the same thing a
 * link carries. Nothing a stranger publishes can put a byte on anybody's disk that the catalog
 * did not already sign.
 *
 * Secrets: GITHUB_TOKEN (fine-grained, this repository only: Contents and Actions read and write),
 * SESSION_SECRET and USER_SECRET (random, 32 bytes each), SIGNING_KEY (ed25519, PKCS#8 in base64).
 * Secrets are set with `npx wrangler secret put <NAME>` from this folder.
 */

export const LIMITS = {
  name: 80,
  about: 500,
  code: 64 * 1024,
  json: 512 * 1024,
  mods: 500,
  presetsPerAuthor: 30,
  votesPerUser: 5000,
};
const MIN_ACCOUNT_DAYS = 14;
const SESSION_DAYS = 30;
const DISCORD_EPOCH = 1420070400000n;
const COSMETIC_TAG = '$cos';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(String(s).replace(/\s+/g, '')), (c) => c.charCodeAt(0));

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The key a Discord account is known by in the branch: 16 hex characters, the same every time. */
export async function userKey(env, discordId) {
  return hex(await hmac(env.USER_SECRET, `user:${discordId}`)).slice(0, 16);
}

/** When a Discord account was made, from its id (a snowflake carries its own timestamp). */
export function accountCreated(discordId) {
  try {
    return Number((BigInt(discordId) >> 22n) + DISCORD_EPOCH);
  } catch {
    return NaN;
  }
}

export async function makeSession(env, user, now) {
  const body = b64url(enc.encode(JSON.stringify({ k: user.key, n: user.name, e: now + SESSION_DAYS * 86400000 })));
  return `${body}.${b64url(await hmac(env.SESSION_SECRET, body))}`;
}

/** The session's account when it is ours, intact and not expired, or null. */
export async function readSession(env, token, now) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  try {
    if (!same(unb64url(sig), await hmac(env.SESSION_SECRET, body))) return null;
    const s = JSON.parse(dec.decode(unb64url(body)));
    if (typeof s.k !== 'string' || !/^[0-9a-f]{16}$/.test(s.k) || !(s.e > now)) return null;
    return { key: s.k, name: String(s.n || '').slice(0, 80) };
  } catch {
    return null;
  }
}

/** Raw deflate undone, refusing to grow past `max` bytes: a small code must not be an inflate bomb. */
async function inflateRaw(bytes, max) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error('too big');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const isText = (v, max) => typeof v === 'string' && v.length <= max;

/**
 * A preset code checked the way the app reads it (crates/mm-core/src/presets/preset_link.rs):
 * the mods it holds, or an error for the person who pasted it. The app decodes it again and has
 * the last word; this is only so a broken code is refused at the door instead of published.
 */
export async function readCode(code) {
  if (typeof code !== 'string' || !code || code.length > LIMITS.code || !/^[A-Za-z0-9_-]+$/.test(code)) {
    return { error: 'not a preset code' };
  }
  let raw;
  try {
    const usable = code.length % 4 === 1 ? code.slice(0, -1) : code;
    raw = JSON.parse(dec.decode(await inflateRaw(unb64url(usable), LIMITS.json)));
  } catch {
    return { error: 'the code is damaged' };
  }
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.m)) return { error: 'the code is damaged' };
  if (raw.m.length > LIMITS.mods) return { error: 'too many mods' };
  const mods = raw.m.filter((e) => Array.isArray(e) && isText(e[0], 300) && isText(e[1], 300) && e[0] && e[1]
    && (e[0] !== COSMETIC_TAG || (isText(e[2], 20) && e[2])));
  if (!mods.length) return { error: 'the preset has no mods' };
  return { mods: mods.length };
}

/** A name or a description as it is stored: one line or a few, no control characters, trimmed. */
export function cleanText(v, max, lines) {
  let s = String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, '');
  if (!lines) s = s.replace(/\n/g, ' ');
  return s.replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

let signingKey = null;
async function sign(env, text) {
  if (!signingKey) {
    signingKey = await crypto.subtle.importKey('pkcs8', unb64(env.SIGNING_KEY), { name: 'Ed25519' }, false, ['sign']);
  }
  return b64(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, signingKey, enc.encode(text))));
}

/** The repository's files through the GitHub API, on BRANCH. */
export function repo(env) {
  const api = (env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
  const name = env.REPO || 'dota2modmanager/dota2-mod-manager';
  const branch = env.BRANCH || 'community-presets';
  const headers = {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'd2mm-presets-worker',
  };
  const url = (path) => `${api}/repos/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  return {
    /** A file and its blob sha, or null when there is none. */
    async read(path) {
      const r = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}`, { headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      const f = await r.json();
      return { sha: f.sha, text: dec.decode(unb64(f.content || '')) };
    },
    /** The names in a folder, or none when it is not there yet. */
    async list(path) {
      const r = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}`, { headers });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      const items = await r.json();
      return Array.isArray(items) ? items.filter((i) => i.type === 'file').map((i) => i.name) : [];
    },
    /** Write a file; `sha` is the blob it replaces, which GitHub checks, so two writers cannot both win. */
    async write(path, text, message, sha) {
      const body = { message, content: b64(enc.encode(text)), branch, ...(sha ? { sha } : {}) };
      const r = await fetch(url(path), { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 409 || r.status === 422) return false;
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      return true;
    },
    async remove(path, message, sha) {
      const r = await fetch(url(path), {
        method: 'DELETE', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ message, sha, branch }),
      });
      if (r.status === 409 || r.status === 422) return false;
      if (!r.ok && r.status !== 404) throw new Error(`GitHub ${r.status}`);
      return true;
    },
    /** Ask the workflow to rebuild index.json now rather than at its next scheduled run. */
    async rebuild() {
      const wf = env.WORKFLOW || 'community-presets.yml';
      await fetch(`${api}/repos/${name}/actions/workflows/${wf}/dispatches`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ ref: env.WORKFLOW_REF || 'main' }),
      }).catch(() => {});
    },
  };
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const fail = (status, error) => json(status, { error });

async function body(request) {
  const text = await request.text();
  if (text.length > LIMITS.code + 4096) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function votesOf(gh, key) {
  const f = await gh.read(`votes/${key}.json`);
  let votes = {};
  try {
    const v = f ? JSON.parse(f.text) : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) votes = v;
  } catch { /* a broken file is no votes: the next vote rewrites it */ }
  return { sha: f?.sha, votes };
}

const PRESET_ID = /^[0-9a-f]{16}-[0-9a-z]{6}$/;
/** 32 characters, so a random byte's low five bits pick one evenly: `% 36` favoured the first four. */
const TAIL_ALPHABET = '0123456789abcdefghijklmnopqrstuv';

/** Six random characters after the author's key: the rest of a preset's id. */
export function randomTail(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(6)].map((x) => TAIL_ALPHABET[x & 31]).join('');
}

async function session(env, request, now) {
  const b = await body(request);
  const token = b && typeof b.discordToken === 'string' ? b.discordToken : '';
  if (!token || token.length > 200) return fail(400, 'discordToken is required');
  const api = (env.DISCORD_API || 'https://discord.com/api/v10').replace(/\/+$/, '');
  const r = await fetch(`${api}/users/@me`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return fail(401, 'Discord did not accept the sign-in');
  const u = await r.json();
  const id = String(u.id || '');
  if (!/^\d{5,25}$/.test(id)) return fail(401, 'Discord did not accept the sign-in');
  if (!(now - accountCreated(id) >= MIN_ACCOUNT_DAYS * 86400000)) return fail(403, 'account too new');
  const user = { key: await userKey(env, id), name: cleanText(u.global_name || u.username || '', 80, false) };
  return json(200, { session: await makeSession(env, user, now), user });
}

async function publish(env, gh, user, request, now) {
  const b = await body(request);
  if (!b) return fail(400, 'bad request');
  const name = cleanText(b.name, LIMITS.name, false);
  const about = cleanText(b.about, LIMITS.about, true);
  if (!name) return fail(400, 'name is required');
  const checked = await readCode(b.code);
  if (checked.error) return fail(400, checked.error);
  const mine = (await gh.list('presets')).filter((f) => f.startsWith(`${user.key}-`));
  if (mine.length >= LIMITS.presetsPerAuthor) return fail(429, 'too many presets');
  const id = `${user.key}-${randomTail()}`;
  const record = JSON.stringify({
    v: 1, id, name, about, code: b.code, mods: checked.mods,
    author: { key: user.key, name: user.name }, created: new Date(now).toISOString(),
  });
  const file = JSON.stringify({ record, sig: await sign(env, record) }, null, 1);
  if (!await gh.write(`presets/${id}.json`, `${file}\n`, `Publish preset ${id}`)) return fail(409, 'try again');
  await gh.rebuild();
  return json(200, { id });
}

async function unpublish(gh, user, request) {
  const b = await body(request);
  const id = b && typeof b.id === 'string' ? b.id : '';
  if (!PRESET_ID.test(id)) return fail(404, 'no such preset');
  if (!id.startsWith(`${user.key}-`)) return fail(403, 'not your preset');
  const f = await gh.read(`presets/${id}.json`);
  if (!f) return fail(404, 'no such preset');
  if (!await gh.remove(`presets/${id}.json`, `Remove preset ${id}`, f.sha)) return fail(409, 'try again');
  await gh.rebuild();
  return json(200, { ok: true });
}

async function vote(gh, user, request) {
  const b = await body(request);
  const id = b && typeof b.id === 'string' ? b.id : '';
  const value = b?.value;
  if (!PRESET_ID.test(id) || ![1, -1, 0].includes(value)) return fail(400, 'bad request');
  if (id.startsWith(`${user.key}-`)) return fail(403, 'not on your own preset');
  if (value !== 0 && !await gh.read(`presets/${id}.json`)) return fail(404, 'no such preset');
  // read, change, write with the sha read: a second press racing the first is told to retry
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sha, votes } = await votesOf(gh, user.key);
    if ((votes[id] || 0) === value) return json(200, { ok: true, votes });
    if (value === 0) delete votes[id];
    else votes[id] = value;
    if (Object.keys(votes).length > LIMITS.votesPerUser) return fail(429, 'too many votes');
    const text = `${JSON.stringify(votes, Object.keys(votes).sort(), 0)}\n`;
    if (await gh.write(`votes/${user.key}.json`, text, `Vote ${value > 0 ? '+' : value < 0 ? '-' : '0'} ${id}`, sha)) {
      await gh.rebuild();
      return json(200, { ok: true, votes });
    }
  }
  return fail(409, 'try again');
}

export default {
  async fetch(request, env) {
    const now = Date.now();
    const { pathname } = new URL(request.url);
    const method = request.method;
    try {
      if (method === 'POST' && pathname === '/session') return await session(env, request, now);
      const auth = request.headers.get('authorization') || '';
      const user = await readSession(env, auth.replace(/^Bearer\s+/i, ''), now);
      if (!user) return fail(401, 'sign in first');
      const gh = repo(env);
      if (method === 'GET' && pathname === '/me') return json(200, { user, votes: (await votesOf(gh, user.key)).votes });
      if (method === 'POST' && pathname === '/presets') return await publish(env, gh, user, request, now);
      if (method === 'POST' && pathname === '/unpublish') return await unpublish(gh, user, request);
      if (method === 'POST' && pathname === '/votes') return await vote(gh, user, request);
      return fail(404, 'not found');
    } catch (e) {
      // what went wrong is for the worker's log (observability is on), not for the caller
      console.error(e);
      return fail(502, 'upstream error');
    }
  },
};

/**
 * The pumpkin's keys: one per person, and each one opens one pumpkin.
 *
 * The first Halloween hunt gave everybody who caught the runner the same key, and a key that is
 * the same for everybody is a key that is in Discord a minute later. So the site no longer holds
 * a key at all. It asks this worker for one when the runner is caught, the worker makes a new
 * one, and the app spends it: the first install that brings it keeps it, and any other install
 * that tries the same key is told it was eaten by another pumpkin.
 *
 *   POST /ticket                 the chase has started; a signed note of when
 *   POST /claim   {ticket}       the runner is caught; a fresh key, if the chase was real enough
 *   POST /redeem  {key, install} the app spends the key; tied to that install from then on
 *   GET  /mod?key=&install=      the prize itself, only to the install that spent the key
 *   GET  /mod/preview            its picture, for the window that offers it
 *
 * What it can and cannot stop. The hunt runs in the visitor's browser, so nothing here can prove
 * a chase happened; a determined person reads the site's code and calls /claim. What it does stop
 * is the thing that matters: a key posted in a channel works once, for whoever is fastest, and
 * never again. The ticket and its minimum age keep /claim from being a one-line script, and the
 * per-address limit keeps one person from filling a channel with keys.
 *
 * Addresses are never stored, only a keyed hash of them, which is enough to count by and useless
 * for anything else. Keys are stored as themselves: they are worthless the moment they are spent.
 *
 * Storage: D1 (schema.sql) for tickets and keys, a private R2 bucket for the prize. Secrets:
 * TICKET_SECRET (signs tickets), ADDR_SALT (hashes addresses). See README.md.
 */

const CHASE_MIN_MS = 12000;           // a ticket younger than this is not a chase anybody ran
const TICKET_MAX_MS = 2 * 3600 * 1000;
const PER_ADDRESS_PER_DAY = 3;
const KEY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // no 0/O, 1/I/L: it gets typed by hand

const ORIGINS = ['https://dota2modmanager.com', 'https://www.dota2modmanager.com', 'https://dota2modmanager.pages.dev'];

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

/** Constant-time comparison of two byte arrays. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** A key as it is stored and compared: upper case, letters and digits only. */
export const plainKey = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/** A fresh key, 16 characters from KEY_ALPHABET, shown as XXXX-XXXX-XXXX-XXXX. */
export function newKey(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  // rejection sampling, so every character is equally likely
  let out = '';
  while (out.length < 16) {
    for (const b of random(24)) {
      if (b >= KEY_ALPHABET.length * Math.floor(256 / KEY_ALPHABET.length)) continue;
      out += KEY_ALPHABET[b % KEY_ALPHABET.length];
      if (out.length === 16) break;
    }
  }
  return out.match(/.{4}/g).join('-');
}

export async function makeTicket(env, now) {
  const body = b64url(enc.encode(JSON.stringify({ t: now, n: b64url(crypto.getRandomValues(new Uint8Array(12))) })));
  return `${body}.${b64url(await hmac(env.TICKET_SECRET, body))}`;
}

/** The ticket's contents when it is ours and intact, or null. */
export async function readTicket(env, ticket) {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig) return null;
  try {
    if (!same(unb64url(sig), await hmac(env.TICKET_SECRET, body))) return null;
    const v = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return typeof v.t === 'number' && typeof v.n === 'string' ? v : null;
  } catch {
    return null;
  }
}

const addressOf = async (env, req) => b64url(await hmac(env.ADDR_SALT, req.headers.get('CF-Connecting-IP') || 'unknown')).slice(0, 22);

function cors(req) {
  const origin = req.headers.get('Origin') || '';
  const ok = ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {};
}

const json = (req, status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) },
});

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

export async function claim(env, req, now) {
  const { ticket } = await body(req);
  const t = await readTicket(env, ticket);
  if (!t) return json(req, 400, { error: 'ticket' });
  const age = now - t.t;
  if (age < CHASE_MIN_MS) return json(req, 425, { error: 'early' });
  if (age > TICKET_MAX_MS) return json(req, 410, { error: 'stale' });

  const addr = await addressOf(env, req);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM keys WHERE addr = ? AND issued_at > ?').bind(addr, now - 86400000).first();
  if ((recent?.n ?? 0) >= PER_ADDRESS_PER_DAY) return json(req, 429, { error: 'enough' });

  // a ticket is spent by the claim it makes, so one chase is one key
  const spent = await env.DB.prepare('INSERT OR IGNORE INTO tickets (nonce, used_at) VALUES (?, ?)').bind(t.n, now).run();
  if (!spent.meta?.changes) return json(req, 409, { error: 'spent' });

  for (let i = 0; i < 4; i++) {
    const key = newKey();
    const put = await env.DB.prepare('INSERT OR IGNORE INTO keys (key, issued_at, addr) VALUES (?, ?, ?)').bind(plainKey(key), now, addr).run();
    if (put.meta?.changes) return json(req, 200, { key });
  }
  return json(req, 500, { error: 'busy' });
}

const validInstall = (s) => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);

export async function redeem(env, req, now) {
  const { key, install } = await body(req);
  const k = plainKey(key);
  if (k.length !== 16 || !validInstall(install)) return json(req, 400, { error: 'wrong' });
  // taken by this install if nobody has it, or kept if this install already does: one statement,
  // so two pumpkins trying the same key at the same moment cannot both have it
  const took = await env.DB.prepare('UPDATE keys SET install = ?, redeemed_at = COALESCE(redeemed_at, ?) WHERE key = ? AND (install IS NULL OR install = ?)')
    .bind(install, now, k, install).run();
  if (took.meta?.changes) return json(req, 200, { ok: true, prize: env.PRIZE_NAME || 'necrophos-scream' });
  const row = await env.DB.prepare('SELECT install FROM keys WHERE key = ?').bind(k).first();
  return json(req, row ? 409 : 404, { error: row ? 'used' : 'wrong' });
}

async function prize(env, req, url, name) {
  const k = plainKey(url.searchParams.get('key'));
  const install = url.searchParams.get('install');
  if (!validInstall(install)) return json(req, 400, { error: 'wrong' });
  const row = await env.DB.prepare('SELECT install FROM keys WHERE key = ?').bind(k).first();
  if (!row || row.install !== install) return json(req, 403, { error: 'not-yours' });
  const obj = await env.PRIZE.get(name);
  if (!obj) return json(req, 404, { error: 'missing' });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Cache-Control': 'private, no-store',
      ...(obj.customMetadata?.sha256 ? { 'X-Sha256': obj.customMetadata.sha256 } : {}),
    },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const now = Date.now();
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    try {
      if (req.method === 'POST' && url.pathname === '/ticket') return json(req, 200, { ticket: await makeTicket(env, now) });
      if (req.method === 'POST' && url.pathname === '/claim') return await claim(env, req, now);
      if (req.method === 'POST' && url.pathname === '/redeem') return await redeem(env, req, now);
      if (req.method === 'GET' && url.pathname === '/mod') return await prize(env, req, url, env.PRIZE_OBJECT || 'necrophos-scream.vpk');
      if (req.method === 'GET' && url.pathname === '/mod/preview') return await prize(env, req, url, env.PRIZE_PREVIEW || 'necrophos-scream.png');
      if (req.method === 'GET' && url.pathname === '/') return new Response('The pumpkin is listening.\n', { headers: { 'Content-Type': 'text/plain' } });
      return json(req, 404, { error: 'nothing here' });
    } catch (err) {
      console.error(err);
      return json(req, 500, { error: 'broken' });
    }
  },
};

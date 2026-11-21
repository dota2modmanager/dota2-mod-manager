/**
 * The presets worker on this machine, for trying the app against it: the worker itself under
 * Node, a folder standing in for the community-presets branch, and stand-ins for GitHub's contents
 * API and Discord. Nothing leaves the machine.
 *
 *   node tools/ops/presets-worker/dev.mjs <folder> [port]
 *
 * It prints the three variables a debug build of the app reads (community_presets.rs Endpoints)
 * and, for each name asked of /dev/session?name=, a session to put in the test profile's
 * community-session.json, since the real sign-in goes through Discord. index.json is rebuilt after
 * every write, as the workflow would.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import worker, { makeSession, userKey } from './worker.mjs';
import { writeIndex } from './index.mjs';

const dir = path.resolve(process.argv[2] || 'presets-dev');
const port = Number(process.argv[3] || 8788);
const base = `http://127.0.0.1:${port}`;
fs.mkdirSync(path.join(dir, 'presets'), { recursive: true });
fs.mkdirSync(path.join(dir, 'votes'), { recursive: true });

/** A file's text, or null when there is none; read once rather than checked and then read. */
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return null;
    throw e;
  }
}

const keyFile = path.join(dir, '.signing.json');
function devKeys() {
  const kept = readText(keyFile);
  if (kept) return JSON.parse(kept);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const made = {
    signing: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    public: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
  try {
    // 'wx': a second copy started at the same moment keeps the first one's key
    fs.writeFileSync(keyFile, JSON.stringify(made), { flag: 'wx' });
    return made;
  } catch (e) {
    if (e.code === 'EEXIST') return JSON.parse(readText(keyFile));
    throw e;
  }
}
const keys = devKeys();
const env = {
  GITHUB_TOKEN: 'dev', SESSION_SECRET: 'dev-session-secret', USER_SECRET: 'dev-user-secret', SIGNING_KEY: keys.signing,
  GITHUB_API: `${base}/gh`, DISCORD_API: `${base}/discord`,
};

const sha = (text) => crypto.createHash('sha1').update(text).digest('hex');
const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
/** A Discord id from a name, for an account a year old. */
const discordId = (name) => String(((BigInt(Date.now() - 365 * 86400000) - 1420070400000n) << 22n) + BigInt(parseInt(sha(name).slice(0, 6), 16)));

function github(req, res, url, body) {
  const rel = decodeURIComponent(url.pathname.replace(/^\/gh\/repos\/[^/]+\/[^/]+\/contents\//, ''));
  if (url.pathname.endsWith('/dispatches')) { writeIndex(dir); return send(res, 204, ''); }
  const file = path.join(dir, rel);
  if (!file.startsWith(dir)) return send(res, 400, {});
  if (req.method === 'GET') {
    let names = null;
    try {
      names = fs.readdirSync(file);
    } catch { /* not a folder: a file, or nothing */ }
    if (names) return send(res, 200, names.map((name) => ({ type: 'file', name })));
    const text = readText(file);
    if (text === null) return send(res, 404, {});
    return send(res, 200, { sha: sha(text), content: Buffer.from(text).toString('base64') });
  }
  const b = JSON.parse(body || '{}');
  const text = readText(file);
  const cur = text === null ? undefined : sha(text);
  if (cur !== (b.sha || undefined)) return send(res, 409, {});
  // one process, one request at a time between the read and the write: the sha check above is
  // the contents API's, not a lock, and a stand-in for one machine needs no more
  if (req.method === 'PUT') fs.writeFileSync(file, Buffer.from(b.content, 'base64'));
  if (req.method === 'DELETE') fs.rmSync(file, { force: true });
  return send(res, 200, {});
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, base);
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    if (url.pathname.startsWith('/gh/')) return github(req, res, url, body);
    if (url.pathname === '/discord/users/@me') {
      const name = String(req.headers.authorization || '').replace(/^Bearer dev-/, '');
      return name ? send(res, 200, { id: discordId(name), username: name }) : send(res, 401, {});
    }
    if (url.pathname === '/index.json') {
      writeIndex(dir);
      return send(res, 200, fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    }
    if (url.pathname === '/dev/session') {
      const name = url.searchParams.get('name') || 'tester';
      const user = { key: await userKey(env, discordId(name)), name };
      return send(res, 200, { session: await makeSession(env, user, Date.now()), user });
    }
    const r = await worker.fetch(new Request(`${base}${url.pathname}`, {
      method: req.method, headers: { authorization: req.headers.authorization || '' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    }), env);
    return send(res, r.status, await r.text());
  } catch (e) {
    // the reason goes to this console, not to whoever asked
    console.error(e);
    return send(res, 500, { error: 'internal error' });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`presets worker on ${base}, branch in ${dir}`);
  console.log(`D2MM_COMMUNITY_API=${base}`);
  console.log(`D2MM_COMMUNITY_INDEX=${base}/index.json`);
  console.log(`D2MM_COMMUNITY_KEY=${keys.public}`);
});

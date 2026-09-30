// The download path decides whether somebody in a country where raw.githubusercontent is
// throttled gets a mod at all, and whether a 300 MB download survives a train tunnel. Pinned
// against local servers that misbehave on purpose: one that is down, one that ignores Range,
// one that hands over the wrong bytes.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';

import * as net from '../src/net.ts';
import type { Mirror } from '../src/net.ts';
const { RAW_HOST } = net;

const RAW_URL = `${RAW_HOST}h6rd/Dota2PornFxWeb/main/assets/files/heroes/Mod.zip`;

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/** A server whose behaviour each test decides: how often it was asked, its port, and itself as a mirror. */
interface Served { hits: number; port: number; mirror(): Mirror }

function serve(t: TestContext, handler: Handler): Promise<Served> {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => { state.hits++; handler(req, res); });
  server.listen(0, '127.0.0.1');
  t.after(() => server.close());
  return new Promise((resolve) => {
    server.on('listening', () => {
      const { port } = server.address() as AddressInfo;
      resolve(Object.assign(state, {
        port,
        mirror(): Mirror {
          return { host: `127.0.0.1:${port}`, map: (u: string) => u.replace(RAW_HOST, `http://127.0.0.1:${port}/`) };
        },
      }));
    });
  });
}

const body = (text: string): Handler => (req, res) => { res.writeHead(200, { 'content-length': Buffer.byteLength(text) }); res.end(text); };
const dead = (status: number): Handler => (req, res) => { res.writeHead(status); res.end('no'); };

// A server that serves `data` and honours Range, the way every measured mirror does.
const ranged = (data: Buffer): Handler => (req, res) => {
  const m = /^bytes=(\d+)-/.exec(req.headers.range || '');
  if (!m) { res.writeHead(200, { 'content-length': data.length, 'accept-ranges': 'bytes' }); res.end(data); return; }
  const from = Number(m[1]);
  res.writeHead(206, {
    'content-length': data.length - from,
    'content-range': `bytes ${from}-${data.length - 1}/${data.length}`,
  });
  res.end(data.subarray(from));
};

function tempDir(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-net-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test.afterEach(() => net.setMirrors(null));

test('a host the signed config names joins the chain, after our own copy and before the proxies', () => {
  /* The built-in list is compiled in, so arranging a second copy of the catalog somewhere used
     to mean a release and then waiting for people to take it. */
  const GITLAB = 'https://gitlab.com/rotten/mirror/-/raw/main/assets/files/';
  net.applyMirrors([{ id: 'gitlab', base: GITLAB, host: 'gitlab.com' }]);

  const list = net.mirrorsFor(RAW_URL);
  const at = list.findIndex((u) => u.startsWith(GITLAB));
  assert.equal(list[at], `${GITLAB}heroes/Mod.zip`, 'the path after assets/files/ is kept');
  // the whole prefix, not a host anywhere in the string: a substring check here reads as a
  // security check to the scanner, and it would be a bad one
  assert.ok(at > list.findIndex((u) => u.startsWith('https://cdn.dota2modmanager.com/')), 'after our own bucket');
  assert.ok(at < list.findIndex((u) => u.startsWith('https://ghproxy.net/')), 'before the proxies, which are GitHub again');

  net.applyMirrors([]);
  assert.equal(net.mirrorsFor(RAW_URL).some((u) => u.startsWith(GITLAB)), false, 'and taken out again by an empty list');
});

test('a host named in the config is never the one believed when no copy matches the published hash', () => {
  /* origin means the host the catalog is published from, which is the one host the published
     hashes cannot prove anything about. A file named in the config is somewhere else entirely. */
  net.applyMirrors([
    { id: 'gitlab', base: 'https://gitlab.com/x/-/raw/main/assets/files/', host: 'gitlab.com' },
    { id: 'liar', base: 'https://raw.githubusercontent.com/x/y/main/assets/files/', host: 'raw.githubusercontent.com' },
  ]);

  const entries = net.entriesFor(RAW_URL);
  const origins = entries.filter((e) => e.origin);
  assert.equal(origins.length, 1, 'exactly one entry is the origin');
  assert.equal(origins[0].url, RAW_URL);
  assert.equal(entries.filter((e) => e.host === 'raw.githubusercontent.com').length, 1,
    'and an entry claiming that host is dropped rather than added beside it');
});

test('a GitHub raw URL gets mirrors, and a size-capped one only for small files', () => {
  const big = net.mirrorsFor(RAW_URL);
  const small = net.mirrorsFor(RAW_URL, { small: true });
  assert.equal(big[0], RAW_URL, 'the original host is tried first');
  assert.ok(!big.some((u) => u.includes('jsdelivr')), 'jsDelivr caps file size, so it is out for archives');
  assert.ok(small.some((u) => u.includes('cdn.jsdelivr.net/gh/h6rd/Dota2PornFxWeb@main/')), 'and in for JSON');
  assert.ok(big.some((u) => u.startsWith('https://ghproxy.net/')), 'the proxies wrap the whole raw URL');
});

// Every other mirror is a proxy in front of GitHub and dies with it. This one is the site,
// which is deployed elsewhere, and it carries the four files the app cannot start without.
test('the four startup files can also come from the site, and nothing else can', () => {
  const catalog = `${RAW_HOST}h6rd/Dota2PornFxWeb/main/assets/data/mods.json`;
  const prints = `${RAW_HOST}dota2modmanager/dota2-mod-manager/main/fingerprints.json`;
  for (const url of [catalog, prints]) {
    const list = net.mirrorsFor(url, { small: true });
    assert.ok(list.includes(`https://dota2modmanager.com/mirror/${url.split('/').pop()}`), url);
    assert.equal(list[0], url, 'GitHub is still asked first');
  }
  const mod = `${RAW_HOST}h6rd/Dota2PornFxWeb/main/assets/files/heroes/some-mod.zip`;
  // The bucket on cdn. holds the archives; the site itself must not be asked for one.
  assert.ok(!net.mirrorsFor(mod, { small: true }).some((u) => u.startsWith('https://dota2modmanager.com/mirror/')),
    'a mod archive is not on the site and must not be asked for there');
});

// The archives live in a bucket now, which is the only entry on the list that is not GitHub
// wearing a different hostname. The catalog JSON must not be asked for there and the bucket
// must not be asked before the origin.
test('a mod archive can come from the bucket, after GitHub and not before it', () => {
  const mod = `${RAW_HOST}h6rd/Dota2PornFxWeb/main/assets/files/heroes/Gopo%20Pudge.zip`;
  const list = net.mirrorsFor(mod);
  assert.equal(list[0], mod, 'the origin is still asked first');
  assert.equal(list[1], 'https://cdn.dota2modmanager.com/assets/files/heroes/Gopo%20Pudge.zip');
  assert.ok(list.indexOf('https://cdn.dota2modmanager.com/assets/files/heroes/Gopo%20Pudge.zip')
    < list.findIndex((u) => u.includes('ghproxy')), 'and before the proxies, which go down with GitHub');

  const catalog = `${RAW_HOST}h6rd/Dota2PornFxWeb/main/assets/data/mods.json`;
  assert.ok(!net.mirrorsFor(catalog, { small: true }).some((u) => u.includes('cdn.dota2modmanager.com')),
    'the catalog json is on the site, not in the bucket');
});

test('a URL that is not on GitHub raw is its own only mirror', () => {
  const other = 'https://example.com/some/mod.zip';
  assert.deepEqual(net.mirrorsFor(other), [other]);
});

// A proxy hands over bytes claiming they are GitHub's, which is a fair trade for a mod archive
// and not for a file that says which bytes to trust. src/portable-update.ts asks for the portable
// build's manifest this way: it carries the hash the downloaded exe is checked against.
test('a file asked for trusted-only goes to GitHub itself or nowhere', () => {
  assert.deepEqual(net.mirrorsFor(RAW_URL, { small: true, trustedOnly: true }), [RAW_URL]);
  assert.ok(net.mirrorsFor(RAW_URL, { small: true }).length > 1, 'and the ordinary path still has its mirrors');

  const manifest = 'https://github.com/dota2modmanager/dota2-mod-manager/releases/download/v2.6.11/portable.yml';
  assert.deepEqual(net.mirrorsFor(manifest, { small: true, trustedOnly: true }), [manifest],
    'the manifest the portable build really asks for this way');
});

test('a mirror that is down is stepped over', async (t) => {
  const down = await serve(t, dead(500));
  const up = await serve(t, body('the catalog'));
  net.setMirrors([down.mirror(), up.mirror()]);

  assert.equal(await net.fetchText(RAW_URL), 'the catalog');
  assert.equal(up.hits, 1);
  assert.ok(down.hits >= 1, 'and it was the first one asked');
});

test('a mirror that keeps failing is stood down instead of asked every time', async (t) => {
  const down = await serve(t, dead(500));
  const up = await serve(t, body('ok'));
  net.setMirrors([down.mirror(), up.mirror()]);

  for (let i = 0; i < 4; i++) await net.fetchText(RAW_URL);
  assert.equal(net.mirrorHealth().length, 1, 'one host is standing down');
  assert.ok(down.hits <= net.FAIL_THRESHOLD, `asked ${down.hits} times, not ${4 * 2}`);
  assert.equal(up.hits, 4, 'and every request still got its answer');
});

test('a 404 is the file missing, not the mirror failing', async (t) => {
  const first = await serve(t, dead(404));
  const second = await serve(t, body('should not be reached'));
  net.setMirrors([first.mirror(), second.mirror()]);

  await assert.rejects(() => net.fetchText(RAW_URL), /404/);
  assert.equal(second.hits, 0, 'no point asking another mirror of the same repo');
});

test('a download that was cut short resumes where it stopped', async (t) => {
  const data = crypto.randomBytes(64 * 1024);
  const server = await serve(t, ranged(data));
  net.setMirrors([server.mirror()]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'Mod.zip');

  // what an interrupted attempt left behind
  fs.writeFileSync(`${dest}.part`, data.subarray(0, 20000));
  const res = await net.downloadFile(RAW_URL, dest);

  assert.equal(res.resumedFrom, 20000, 'it asked for the rest, not the whole thing');
  assert.deepEqual(fs.readFileSync(dest), data);
  assert.equal(fs.existsSync(`${dest}.part`), false, 'and cleaned up after itself');
});

test('a mirror that ignores Range makes it start over rather than glue two files together', async (t) => {
  const data = crypto.randomBytes(32 * 1024);
  const server = await serve(t, (req, res) => { res.writeHead(200, { 'content-length': data.length }); res.end(data); });
  net.setMirrors([server.mirror()]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'Mod.zip');
  fs.writeFileSync(`${dest}.part`, Buffer.from('half of something else'));

  const res = await net.downloadFile(RAW_URL, dest);
  assert.equal(res.resumedFrom, 0);
  assert.deepEqual(fs.readFileSync(dest), data);
});

test('a file that hashes to something else than last time is refused', async (t) => {
  const data = Buffer.from('not the mod you asked for');
  const server = await serve(t, ranged(data));
  net.setMirrors([server.mirror()]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'Mod.zip');

  await assert.rejects(
    () => net.downloadFile(RAW_URL, dest, { expectSha256: 'a'.repeat(64) }),
    /checksum/,
  );
  assert.equal(fs.existsSync(dest), false, 'nothing is installed from it');
  assert.equal(fs.existsSync(`${dest}.part`), false, 'and the bad copy is not left to be resumed');
});

/*
 * The mirror is wrong, the mod is not.
 *
 * On 2026-09-10 the bucket was still serving 24 archives in the versions they had months ago,
 * because the sync skipped anything already there under the same name. Every one of them was
 * unreachable for anybody who cannot get to GitHub: the checksum said no and the download gave
 * up on the spot, with three proxies holding the current file and never asked.
 *
 * Both servers here serve real bytes and they are not the same bytes, which is the whole point
 * - a fake mirror that answers correctly on every path proves nothing about a mirror that does
 * not.
 */
test('a mirror serving a stale copy costs that mirror its turn, not the mod', async (t) => {
  const current = crypto.randomBytes(8192);
  const months_old = crypto.randomBytes(6000);
  const stale = await serve(t, ranged(months_old));
  const good = await serve(t, ranged(current));
  net.setMirrors([stale.mirror(), good.mirror()]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'Mod.zip');

  const want = crypto.createHash('sha256').update(current).digest('hex');
  const res = await net.downloadFile(RAW_URL, dest, { expectSha256: want });

  assert.deepEqual(fs.readFileSync(dest), current, 'the mod that was asked for, byte for byte');
  assert.equal(res.sha256, want);
  assert.equal(stale.hits, 1, 'and the mirror that was wrong is not asked twice');
});

test('half a file from a stale mirror is not resumed from the next one', async (t) => {
  const current = crypto.randomBytes(8192);
  const stale = await serve(t, ranged(crypto.randomBytes(8192)));
  const good = await serve(t, ranged(current));
  net.setMirrors([stale.mirror(), good.mirror()]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'Mod.zip');

  const want = crypto.createHash('sha256').update(current).digest('hex');
  const res = await net.downloadFile(RAW_URL, dest, { expectSha256: want });

  assert.equal(res.resumedFrom, 0, 'it started over instead of gluing two mods together');
  assert.deepEqual(fs.readFileSync(dest), current);
});

/*
 * The list is not always right about the file.
 *
 * `mod-hashes.json` named a hash for heroes/Axe Kratos.zip on 2026-09-10 that no copy of that
 * archive has ever had, so the mod was refused for everybody - a working GitHub made no
 * difference. The list is built in the same repository as the archives, so it can say nothing
 * about GitHub that GitHub could not also say about itself; when every copy disagrees with it,
 * the file wins.
 *
 * The first mirror here is the canonical host, so `RAW_URL` maps to itself.
 */
const asOrigin = (port: number): Mirror => ({ host: 'raw.githubusercontent.com', origin: true, map: (u: string) => u.replace(RAW_HOST, `http://127.0.0.1:${port}/`) });

test('a published hash no copy matches is a stale list, and the origin wins', async (t) => {
  const real = crypto.randomBytes(4096);
  const origin = await serve(t, ranged(real));
  const proxy = await serve(t, ranged(real));
  net.setMirrors([asOrigin(origin.port), proxy.mirror()]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'Mod.zip');

  const res = await net.downloadFile(RAW_URL, dest, {
    expectSha256: 'b'.repeat(64), // what the list claims, and what nothing hashes to
    fromPublishedList: true,
  });

  assert.equal(res.unverified, true, 'and it is marked as taken on the origin\'s word');
  assert.deepEqual(fs.readFileSync(dest), real);
  assert.equal(fs.existsSync(`${dest}.origin`), false, 'the copy held back is not left lying around');
});

test('a proxy cannot pass off bytes the origin never served', async (t) => {
  const invented = crypto.randomBytes(4096);
  const origin = await serve(t, dead(503));
  const proxy = await serve(t, ranged(invented));
  net.setMirrors([asOrigin(origin.port), proxy.mirror()]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'Mod.zip');

  // the same stale-list situation, except the one host whose word counts never answered
  await assert.rejects(
    () => net.downloadFile(RAW_URL, dest, { expectSha256: 'b'.repeat(64), fromPublishedList: true }),
  );
  assert.equal(fs.existsSync(dest), false, 'bytes only a proxy ever had are not installed');
  assert.equal(fs.existsSync(`${dest}.origin`), false);
});

/* The catalog keeps its heaviest mods on Hugging Face, and those entries carry a whole URL.
 * Such a URL has no mirrors, which for a moment made it its own origin and so exempt from the
 * check - the exact opposite of what it needs. Nothing on that host is signed by the catalog;
 * the published hash is the only thing connecting those bytes to it. */
test('a mod hosted somewhere else is held to the published hash, not excused from it', async (t) => {
  const elsewhere = await serve(t, ranged(crypto.randomBytes(2048)));
  const url = `http://127.0.0.1:${elsewhere.port}/big-mod.zip`;
  const dir = tempDir(t);
  const dest = path.join(dir, 'big-mod.zip');

  assert.deepEqual(net.mirrorsFor(url), [url], 'it really is its own only source');
  await assert.rejects(
    () => net.downloadFile(url, dest, { expectSha256: 'd'.repeat(64), fromPublishedList: true }),
    /checksum/,
  );
  assert.equal(fs.existsSync(dest), false);
});

test('a hash this project pinned itself is never waived', async (t) => {
  const whatever = crypto.randomBytes(2048);
  const origin = await serve(t, ranged(whatever));
  net.setMirrors([asOrigin(origin.port)]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'toolchain.zip');

  // no fromPublishedList: this is the update binary and the toolchain, where the pinned hash
  // is the whole point of downloading through mirrors at all
  await assert.rejects(
    () => net.downloadFile(RAW_URL, dest, { expectSha256: 'c'.repeat(64) }),
    /checksum/,
  );
  assert.equal(fs.existsSync(dest), false, 'nothing unpacked from a binary that failed its pin');
  assert.equal(fs.existsSync(`${dest}.origin`), false);
});

test('a file every mirror disowns is still refused', async (t) => {
  const one = await serve(t, ranged(crypto.randomBytes(2048)));
  const two = await serve(t, ranged(crypto.randomBytes(2048)));
  net.setMirrors([one.mirror(), two.mirror()]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'Mod.zip');

  await assert.rejects(
    () => net.downloadFile(RAW_URL, dest, { expectSha256: 'a'.repeat(64) }),
    /checksum/,
  );
  assert.equal(fs.existsSync(dest), false, 'nothing is installed from any of them');
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test('a finished download reports the hash it should be remembered by', async (t) => {
  const data = crypto.randomBytes(4096);
  const server = await serve(t, ranged(data));
  net.setMirrors([server.mirror()]);
  const dir = tempDir(t);
  const dest = path.join(dir, 'Mod.zip');

  const res = await net.downloadFile(RAW_URL, dest);
  assert.equal(res.sha256, crypto.createHash('sha256').update(data).digest('hex'));
  assert.equal(res.bytes, data.length);
});

/*
 * The site mirror is a promise made in two places at once.
 *
 * src/net.ts says "ask dota2modmanager.com for this file", and site/tools/mirror.mjs is what
 * puts the file there. They live in different packages and nothing connected them, so the
 * signatures were added to one side and not the other: the app would have asked our own site
 * for mods.json.sig on the one day it matters, and Cloudflare would have answered 200 with the
 * site's 404 page, 43 KB of HTML where 88 characters of base64 belong.
 *
 * A missing file is not the failure mode to guard against here. A present, wrong one is.
 */
test('every file the app expects from our own mirror is a file the site actually copies there', () => {
  const netSource = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'net.ts'), 'utf-8');
  const mirrorTool = fs.readFileSync(path.join(import.meta.dirname, '..', 'site', 'tools', 'mirror.mjs'), 'utf-8');

  // the MIRRORED map: 'owner/repo/branch/path': 'name-on-our-site'
  const promised = [...netSource.matchAll(/^\s*'([\w.\-\/]+)':\s*'([\w.\-]+)',$/gm)];
  assert.ok(promised.length >= 4, 'the MIRRORED map got away from this test');

  for (const [, remotePath, name] of promised) {
    // the mapping is live, not just written down: net.js really offers our site for this URL
    // { small: true }, the way fetchText asks for these: our site is a smallOnly mirror,
    // because it carries the four startup files and never a 300 MB archive.
    const urls = net.mirrorsFor(RAW_HOST + remotePath, { small: true });
    assert.ok(
      urls.some((u) => u.includes(`dota2modmanager.com/mirror/${name}`)),
      `net.js does not actually route ${remotePath} to our mirror`,
    );
    // and the site puts it there
    //
    // The name used to go in as name.replace(/\./g, '\.'), and in a string '\.' is just '.':
    // every dot was replaced with itself and stayed a regex wildcard, so "mods.json" also
    // matched "modsXjson". CodeQL flagged it twice; the check was weaker than it read.
    const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok(
      new RegExp(`'${literal}'`).test(mirrorTool),
      `site/tools/mirror.mjs never copies ${name}, so our mirror would answer with the 404 page`,
    );
  }
});

/*
 * Which failure this was, so the catalog screen can say something a player understands.
 *
 * It used to print "fetch failed" - Node's words for being unable to open a socket - at
 * somebody whose wifi was off, on the screen where the mods should be. Telling those two
 * apart is the whole job: send the person with no connection to check their connection, and
 * do not send that message to the person whose connection is fine and whose server answered.
 */
test('a network that is not there is marked as such', async (t) => {
  net.setMirrors([{ host: '127.0.0.1:1', map: () => 'http://127.0.0.1:1/x.json' }]);
  t.after(() => net.setMirrors(null));

  const err = await net.fetchText(`${RAW_HOST}owner/repo/main/x.json`).then(() => null, (e) => e);
  assert.ok(err, 'a dead host has to fail');
  assert.equal(err.offline, true, 'nothing answered at all, so the connection is the thing to mention');
});

test('a server that answered is not called a missing connection', async (t) => {
  const server = http.createServer((req, res) => { res.writeHead(500); res.end('nope'); });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const { port } = server.address() as AddressInfo;
  net.setMirrors([{ host: `127.0.0.1:${port}`, map: () => `http://127.0.0.1:${port}/x.json` }]);
  t.after(() => { server.close(); net.setMirrors(null); });

  const err = await net.fetchText(`${RAW_HOST}owner/repo/main/x.json`).then(() => null, (e) => e);
  assert.ok(err, 'a 500 from every mirror is still a failure');
  assert.equal(err.offline, false, 'the wifi is fine; saying otherwise sends somebody to fix nothing');
});

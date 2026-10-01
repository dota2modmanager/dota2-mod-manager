// What happens when the data and its signature arrive from different moments in time.
//
// The catalog writes a file and its signature in one commit, so the repository is never
// inconsistent. The thing the app actually reads is, because raw.githubusercontent caches and
// purges per file: on 2026-09-10 it served this project its own config from one commit and that
// config's signature from the one before, for minutes after the push, and a query string did
// not shake it loose. Measured, not feared.
//
// To a signature check that looks exactly like a forgery. It is not, and treating it as one
// costs the catalog to anybody installing the app in those minutes - the failure this whole
// arrangement was supposed to prevent rather than cause.
//
// So a pair that disagrees is asked again from the site's own copy, which goes out in a single
// deploy and cannot be half-updated. A real rewrite fails there too.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

import * as net from '../src/net.ts';
import { Catalog } from '../src/catalog.ts';

const DATA_FILES = ['mods.json', 'constants.json', 'guides.json', 'mod-hashes.json'];

/** Signs a body with the test's own key. */
type Sign = (text: string) => string;

/** What each publisher serves for a file: its body, and a signature made with `sign`. */
type Sides = {
  rawData: (name: string) => string; rawSig: (name: string, sign: Sign) => string;
  snapData: (name: string) => string; snapSig: (name: string, sign: Sign) => string;
};

function userDir(t: TestContext) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-skew-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Two publishers of the same catalog: `raw`, which may be serving a stale half, and `snapshot`,
 * which is always internally consistent. Both are signed by the same key, and the test pins that
 * key so the real one is never involved.
 */
async function publish(t: TestContext, { rawData, rawSig, snapData, snapSig }: Sides) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const sign: Sign = (text) => crypto.sign(null, Buffer.from(text), privateKey).toString('base64');

  const bodies = new Map<string, string>();
  for (const name of DATA_FILES) {
    bodies.set(`/raw/${name}`, rawData(name));
    bodies.set(`/raw/${name}.sig`, rawSig(name, sign));
    bodies.set(`/snap/${name}`, snapData(name));
    bodies.set(`/snap/${name}.sig`, snapSig(name, sign));
  }

  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    asked.push(url);
    const body = bodies.get(url);
    if (body === undefined) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const { port } = server.address() as AddressInfo;

  // every raw URL goes to /raw/<basename>, keeping the .sig suffix
  net.setMirrors([{ host: `127.0.0.1:${port}`, map: (u) => `http://127.0.0.1:${port}/raw/${u.split('/').pop()}` }]);
  t.after(() => {
    server.close();
    net.setMirrors(null);
  });

  // the catalog is handed this test's key, so the real one is never involved
  return { port, asked, snapshotBase: `http://127.0.0.1:${port}/snap/`, publicKey: pub };
}

const good = (name: string) => JSON.stringify({ modsData: { heroes: [{ name: `from ${name}`, file: `${name}.zip` }] } });

test('a stale signature on one side is not a forgery, and the catalog still loads', async (t) => {
  // exactly the shape observed: the data is current, the signature is the previous one
  const { asked, snapshotBase, publicKey } = await publish(t, {
    rawData: (n) => good(n),
    rawSig: (n, sign) => sign(`${good(n)} as it was an hour ago`),
    snapData: (n) => good(n),
    snapSig: (n, sign) => sign(good(n)),
  });

  const cat = new Catalog(userDir(t), { snapshotBase, publicKey });
  const out = await cat.load({ forceRefresh: true });

  const heroes = out.mods?.modsData?.heroes;
  assert.ok(Array.isArray(heroes) && heroes.length, 'the catalog came through');
  assert.ok(asked.some((u) => u.startsWith('/snap/')), 'it should have asked the snapshot');
});

test('a rewritten catalog fails on both, and is not saved', async (t) => {
  const { snapshotBase, publicKey } = await publish(t, {
    rawData: () => JSON.stringify({ modsData: { heroes: [{ name: 'not from the author' }] } }),
    rawSig: (n, sign) => sign(good(n)),
    snapData: () => JSON.stringify({ modsData: { heroes: [{ name: 'not from the author' }] } }),
    snapSig: (n, sign) => sign(good(n)),
  });

  const dir = userDir(t);
  const cat = new Catalog(dir, { snapshotBase, publicKey });
  await assert.rejects(() => cat.load({ forceRefresh: true }), /signature does not match/);
  assert.ok(!fs.existsSync(cat.cachePath('mods.json')), 'nothing unverified may be written to disk');
});

test('a matching pair never asks the snapshot at all', async (t) => {
  const { asked, snapshotBase, publicKey } = await publish(t, {
    rawData: (n) => good(n),
    rawSig: (n, sign) => sign(good(n)),
    snapData: (n) => good(n),
    snapSig: (n, sign) => sign(good(n)),
  });

  const cat = new Catalog(userDir(t), { snapshotBase, publicKey });
  await cat.load({ forceRefresh: true });

  assert.ok(!asked.some((u) => u.startsWith('/snap/')), 'the fallback is for the skew, not the normal path');
});

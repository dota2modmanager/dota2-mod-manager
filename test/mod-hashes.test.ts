// The catalog's published hashes, and what the downloader does with them.
//
// Until 2026-09-09 an archive was trusted the first time it arrived and checked against that
// first copy ever after: a mirror could hand over anything it liked exactly once, which is the
// one time it would matter. The catalog now publishes a sha256 for every archive, signed like
// the rest of it, so the first download can be checked too.
//
// The rule that shapes all of this: a list that has not caught up must never be a reason a mod
// cannot be installed. On the day it was written the list knew 971 of the 992 archives in the
// catalog, and the 21 it did not know were the newest ones. Refusing those would mean the
// freshest mods break for everybody until a bot on somebody else's repository catches up.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { Catalog, HASH_FILE } from '../src/catalog.ts';
import { Installer } from '../src/installer.ts';

function tmpDir(t: TestContext) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-hash-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A catalog whose cache already holds the given hash list. */
function catalogWith(t: TestContext, hashes: Record<string, unknown> | null) {
  const cat = new Catalog(tmpDir(t));
  if (hashes) fs.writeFileSync(cat.cachePath(HASH_FILE), JSON.stringify(hashes));
  return cat;
}

const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');

/** Serves one body at any path, so a download can be pointed at known bytes. */
function serve(t: TestContext, body: string | Buffer): Promise<number> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  server.listen(0, '127.0.0.1');
  t.after(() => server.close());
  return new Promise((r) => server.on('listening', () => r((server.address() as AddressInfo).port)));
}

function installer(t: TestContext, publishedHash: (categoryId: string, file: string) => string | null) {
  return new Installer({
    userDataDir: tmpDir(t),
    getGamePath: () => null,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
    publishedHash,
  });
}

test('the hash the catalog published is the hash it gives back', (t) => {
  const cat = catalogWith(t, { 'heroes/Bare Brewmaster.zip': 'a'.repeat(64) });
  assert.equal(cat.publishedHash('heroes', 'Bare Brewmaster.zip'), 'a'.repeat(64));
});

test('an archive the list has not caught up with is not a refusal, it is a null', (t) => {
  const cat = catalogWith(t, { 'heroes/Old Mod.zip': 'b'.repeat(64) });
  // the shape of the 21 out of 992 that were missing the day this was written
  assert.equal(cat.publishedHash('heroes', 'Abaddon Endless Night.zip'), null);
  assert.equal(cat.publishedHash('nosuchcategory', 'Old Mod.zip'), null);
});

test('no list at all behaves as no answer, never as an exception', (t) => {
  const cat = catalogWith(t, null);
  assert.equal(cat.publishedHash('heroes', 'Bare Brewmaster.zip'), null);
});

test('anything that is not a sha256 is treated as no answer', (t) => {
  // a truncated file, a placeholder, an object where a string belongs: none of these should
  // become an expectation the downloader then fails every archive against
  const cat = catalogWith(t, {
    'heroes/A.zip': 'not a hash',
    'heroes/B.zip': 'abc',
    'heroes/C.zip': { sha256: 'c'.repeat(64) },
    'heroes/D.zip': `${'d'.repeat(64)}extra`,
  });
  for (const name of ['A.zip', 'B.zip', 'C.zip', 'D.zip']) {
    assert.equal(cat.publishedHash('heroes', name), null, `${name} was taken for a hash`);
  }
});

test('a hash in capitals still matches, because hex has two spellings', (t) => {
  const cat = catalogWith(t, { 'heroes/A.zip': 'ABCDEF'.repeat(10) + 'ABCD' });
  assert.equal(cat.publishedHash('heroes', 'A.zip'), ('ABCDEF'.repeat(10) + 'ABCD').toLowerCase());
});

test('an archive that does not hash to what the catalog published is refused', async (t) => {
  const port = await serve(t, 'not the mod you published');
  const inst = installer(t, () => sha256('the real mod'));

  await assert.rejects(
    () => inst.download('heroes', `http://127.0.0.1:${port}/Mod.zip`, 'Mod'),
    // the sentence a player reads, not "checksum mismatch for Mod.zip"
    /не совпадает с тем, что опубликовал автор|not what the mod's author published/,
    'a mirror handing over other bytes has to fail the download, in words somebody can read',
  );
  // and nothing is left behind pretending to be a mod
  const dir = path.join(inst.downloadsDir, 'heroes');
  const left = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.endsWith('.part')) : [];
  assert.deepEqual(left, [], `left ${left.join(', ')} on disk`);
});

test('an archive that matches is downloaded like any other', async (t) => {
  const body = 'the real mod';
  const port = await serve(t, body);
  const inst = installer(t, () => sha256(body));

  const dest = await inst.download('heroes', `http://127.0.0.1:${port}/Mod.zip`, 'Mod');
  assert.equal(fs.readFileSync(dest, 'utf-8'), body);
});

test('an archive the catalog says nothing about still downloads', async (t) => {
  const body = 'a mod added an hour ago';
  const port = await serve(t, body);
  const inst = installer(t, () => null); // the list has not caught up

  const dest = await inst.download('heroes', `http://127.0.0.1:${port}/New.zip`, 'New');
  assert.equal(fs.readFileSync(dest, 'utf-8'), body);
});

test('a cached copy the catalog now disowns is fetched again rather than installed', async (t) => {
  const body = 'the real mod';
  const port = await serve(t, body);
  const inst = installer(t, () => sha256(body));

  // what a first-download-and-trust world left behind: a file, and a note saying it is fine
  const dir = path.join(inst.downloadsDir, 'heroes');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'Mod.zip');
  fs.writeFileSync(dest, 'the substitute nobody noticed');
  inst.rememberDownload('heroes/Mod.zip', { size: fs.statSync(dest).size, sha256: sha256('the substitute nobody noticed'), at: Date.now() });

  const out = await inst.download('heroes', `http://127.0.0.1:${port}/Mod.zip`, 'Mod');
  assert.equal(fs.readFileSync(out, 'utf-8'), body, 'the cached copy should not have survived');
});

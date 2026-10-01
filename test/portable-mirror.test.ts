// Where a portable build gets its update from when GitHub will not answer.
//
// The portable exe cannot replace itself, so it downloads the new build beside the old one and
// checks it against portable.yml. That manifest carries the hash everything else is measured
// by, so it was fetched from GitHub with mirrors forbidden: a public proxy able to rewrite both
// the hash and the file it describes is a proxy able to hand over anything.
//
// The cost of that rule was the whole feature whenever GitHub was unreachable, which is three
// hours on 2026-08-17 for everybody and an ordinary Tuesday for the part of the userbase that
// cannot reach GitHub at all. Since 2026-09-10 the release also lives in this project's own
// bucket, which is not a proxy, and the updater falls back to it.
//
// What these tests hold down: the fallback happens, the manifest and the binary always come
// from the same place, and a mirror holding an older release cannot pass it off as the new one.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { fetchBeside, type Source } from '../src/portable-update.ts';

const BUILD = 'the new build, all 101 MB of it';
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function tmpDir(t: TestContext) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-pm-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const manifest = (version: string, body = BUILD) => [
  `version: ${version}`,
  'file: Dota-2-Mod-Manager-Portable.exe',
  `size: ${Buffer.byteLength(body)}`,
  `sha256: ${sha256(body)}`,
  '',
].join('\n');

/**
 * Two publishers on one server. `/github/...` can be told to fail, `/mirror/...` answers, and
 * the log records who was asked for what so a test can prove where a file came from.
 */
async function publishers(t: TestContext, { githubDown = false, mirrorVersion = '2.7.0', mirrorBody = BUILD, mirrorSends = null }: {
  githubDown?: boolean; mirrorVersion?: string; mirrorBody?: string; mirrorSends?: string | null;
} = {}) {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    asked.push(url);
    const down = githubDown && url.startsWith('/github/');
    if (down) { res.writeHead(503); res.end('no'); return; }
    if (url.endsWith('portable.yml')) {
      const body = url.startsWith('/github/') ? manifest('2.7.0') : manifest(mirrorVersion, mirrorBody);
      res.writeHead(200, { 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    const body = url.startsWith('/github/') ? BUILD : (mirrorSends ?? mirrorBody);
    res.writeHead(200, { 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const sources: Source[] = [
    { name: 'github', manifest: () => `${base}/github/portable.yml`, asset: (v, f) => `${base}/github/${f}`, trustedOnly: true },
    { name: 'mirror', manifest: () => `${base}/mirror/portable.yml`, asset: (v, f) => `${base}/mirror/${f}`, trustedOnly: false },
  ];
  return { asked, sources };
}

test('GitHub answering means the mirror is never asked', async (t) => {
  const { asked, sources } = await publishers(t);
  const out = await fetchBeside('2.7.0', { dir: tmpDir(t), sources });

  assert.equal(fs.readFileSync(out.path, 'utf-8'), BUILD);
  assert.ok(!asked.some((u) => u.startsWith('/mirror/')), 'the copy is for when the origin is down');
});

test('GitHub down means the update still arrives', async (t) => {
  const { asked, sources } = await publishers(t, { githubDown: true });
  const out = await fetchBeside('2.7.0', { dir: tmpDir(t), sources });

  assert.equal(fs.readFileSync(out.path, 'utf-8'), BUILD);
  assert.ok(asked.some((u) => u === '/mirror/portable.yml'), 'the manifest came from the mirror');
  assert.ok(asked.some((u) => u.startsWith('/mirror/Dota')), 'and so did the build it describes');
  assert.ok(!asked.some((u) => u.startsWith('/github/Dota')), 'nothing was taken from the source that failed');
});

test('a mirror a version behind cannot pass its build off as the new one', async (t) => {
  // The bucket holds one release. Left unchecked it would hand over 2.6.4 named as 2.7.0, and
  // the hash would agree, because both came from the same stale manifest.
  const { sources } = await publishers(t, { githubDown: true, mirrorVersion: '2.6.4', mirrorBody: 'the old build' });
  const dir = tmpDir(t);

  await assert.rejects(() => fetchBeside('2.7.0', { dir, sources }), /2\.6\.4.*2\.7\.0|no source/);
  assert.deepEqual(fs.readdirSync(dir), [], 'and nothing was left on disk');
});

test('a mirror whose bytes are not what its manifest describes is refused', async (t) => {
  // right version, right name, wrong file. The hash is the only thing standing between that
  // and an executable on somebody's disk.
  const { sources } = await publishers(t, { githubDown: true, mirrorSends: 'something else entirely' });
  const dir = tmpDir(t);

  await assert.rejects(() => fetchBeside('2.7.0', { dir, sources }), /checksum mismatch|no source/);
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => !f.endsWith('.part')),
    [],
    'a build that failed its hash must not be left where somebody could run it',
  );
});

test('both sources failing says so rather than returning nothing', async (t) => {
  const { sources } = await publishers(t, { githubDown: true });
  const dead = sources.map((s) => ({ ...s, manifest: () => 'http://127.0.0.1:1/portable.yml' }));

  await assert.rejects(() => fetchBeside('2.7.0', { dir: tmpDir(t), sources: dead }));
});

test('a build already sitting beside the exe is not fetched twice', async (t) => {
  const { asked, sources } = await publishers(t);
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'Dota-2-Mod-Manager-Portable-2.7.0.exe'), BUILD);

  const out = await fetchBeside('2.7.0', { dir, sources });
  assert.equal(out.already, true);
  assert.ok(!asked.some((u) => u.startsWith('/github/Dota')), 'the manifest is enough to know it is there');
});

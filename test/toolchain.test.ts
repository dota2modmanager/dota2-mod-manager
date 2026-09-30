// The toolchain downloads and then runs a third-party binary, which makes the pin the whole
// safety story: a version, a URL that can only be that project's own release page, and a
// SHA-256 that has to match. These tests are about what the app refuses, because that is
// what stands between a moved URL and running somebody else's executable.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import AdmZip from 'adm-zip';

import * as net from '../src/net.ts';
import { createToolchain, BUILT_IN_PINS, validPin, runTool, type ToolProgress } from '../src/toolchain.ts';

function userDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-tool-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A zip that looks like a tool release: the executable plus the DLLs beside it. */
function toolZip(exeName = 'Source2Viewer-CLI.exe') {
  const zip = new AdmZip();
  zip.addFile(exeName, Buffer.from('MZ pretend this is a program'));
  zip.addFile('libSkiaSharp.dll', Buffer.from('a library it needs'));
  return zip.toBuffer();
}

/** Serve `data` at any path, so the pin URL can point at a local server. */
async function serve(t: TestContext, data: Buffer) {
  const server = http.createServer((req, res) => {
    const m = /^bytes=(\d+)-/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'content-length': data.length }); res.end(data); return; }
    const from = Number(m[1]);
    res.writeHead(206, { 'content-length': data.length - from, 'content-range': `bytes ${from}-${data.length - 1}/${data.length}` });
    res.end(data.subarray(from));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  t.after(() => { server.close(); net.setMirrors(null); });
  const { port } = server.address() as AddressInfo;
  // the pin URL is a real github.com release address; the mirror table sends it here
  net.setMirrors([{ host: `127.0.0.1:${port}`, map: () => `http://127.0.0.1:${port}/tool.zip` }]);
  return port;
}

test('every built-in pin passes the check the app enforces on a pin', () => {
  for (const [name, pin] of Object.entries(BUILT_IN_PINS)) {
    assert.ok(validPin(pin, name), `${name} pin is valid`);
  }
});

test('the pins travel with the release, not over the network', (t) => {
  /* config/tools.json was never published, so every start asked main for it, got a 404 and used
     the built-in pins anyway. A channel that never carried anything is not a rollback plan, and an
     unsigned file that can redirect a fifty megabyte download is not one worth keeping. Removed
     2026-09-16; a new tool version travels with a release. */
  /* Substrings, not patterns: a regular expression holding a host name reads to CodeQL as URL
     validation with no anchors, and the first version of this test raised exactly that (#111).
     The same lesson as test/r2-purge.test.js. Only the code is checked, because the comment in
     that file explains this history on purpose. */
  const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'toolchain.ts'), 'utf8');
  const address = ['https://raw.', 'githubusercontent.com'].join('');
  assert.ok(!src.includes(address), 'toolchain.ts has an address to fetch pins from again');
  assert.ok(!src.includes('fetchText'), 'toolchain.ts fetches something other than the archive it pinned');
  // a directory of its own, never the shared temp root: a predictable name there is somebody
  // else's to create first, and it flows into every write the toolchain makes (#112 to #114)
  const tc = createToolchain({ userDataDir: userDir(t) });
  assert.equal('refreshPins' in tc, false, 'createToolchain still hands out a pin refresher');
});

test('both homes of the tool are accepted, and nothing that merely looks like them', () => {
  /* Source 2 Viewer moved from SteamDatabase to an organisation of its own. GitHub redirects
   * the old release URLs, but this check reads the URL as written rather than where it lands,
   * so a pin naming the new owner was refused by a rule that only knew the old one - a stale
   * tool nobody could update, failing closed and quietly.
   *
   * Widening an allowlist is where a check stops meaning anything, so the near-misses are here
   * too: an owner whose name merely ends with the right one must still be refused. */
  const good = BUILT_IN_PINS.vrf;
  const at = (url: string) => validPin({ ...good, url }, 'vrf');
  const rel = '/releases/download/20.0/cli-windows-x64.zip';

  assert.equal(at(`https://github.com/ValveResourceFormat/ValveResourceFormat${rel}`), true, 'where it lives now');
  assert.equal(at(`https://github.com/SteamDatabase/ValveResourceFormat${rel}`), true, 'where it used to');

  assert.equal(at(`https://github.com/notValveResourceFormat/ValveResourceFormat${rel}`), false);
  assert.equal(at(`https://github.com/ValveResourceFormat/ValveResourceFormat-evil${rel}`), false);
  assert.equal(at(`https://github.com/evil/ValveResourceFormat${rel}`), false);
  assert.equal(at(`https://github.com.evil.net/ValveResourceFormat/ValveResourceFormat${rel}`), false);
});

test('a pin is refused unless it points at a project release with a real hash', () => {
  const good = BUILT_IN_PINS.vrf;
  assert.equal(validPin({ ...good, url: 'https://example.com/tool.zip' }, 'vrf'), false, 'any host will not do');
  assert.equal(validPin({ ...good, url: 'https://github.com/someone/else/raw/main/tool.zip' }, 'vrf'), false, 'a raw file is not a release');
  assert.equal(validPin({ ...good, sha256: 'nope' }, 'vrf'), false);
  assert.equal(validPin({ ...good, sha256: undefined }, 'vrf'), false, 'an unpinned tool is not a tool');
  assert.equal(validPin({ ...good, exe: '../../evil.exe' }, 'vrf'), false, 'the executable is a name, not a path');
  assert.equal(validPin({ ...good, version: '' }, 'vrf'), false);
});

// The digest travels in the same file as the URL, so "a GitHub release whose hash matches"
// is something anybody can produce with a repository of their own. Only the tool's own
// project counts, and a config that names no tool at all counts for nothing.
test('a pin may only point at the repository the tool actually comes from', () => {
  const good = BUILT_IN_PINS.vrf;
  const elsewhere = 'https://github.com/attacker/ValveResourceFormat/releases/download/19.2/cli-windows-x64.zip';
  assert.equal(validPin({ ...good, url: elsewhere }, 'vrf'), false, 'somebody else’s release is not the tool');
  assert.equal(validPin(good, 'unknown-tool'), false, 'a tool with no pinned repository has no valid pin');
  assert.equal(validPin(good, undefined), false);
  assert.ok(validPin(good, 'vrf'), 'the real one still passes');
});

test('a tool downloads, unpacks and is found where it says', async (t) => {
  const data = toolZip();
  await serve(t, data);
  const dir = userDir(t);
  const tc = createToolchain({ userDataDir: dir });
  // pretend the built-in pin describes what the local server is about to hand over
  BUILT_IN_PINS.vrf.sha256 = crypto.createHash('sha256').update(data).digest('hex');

  const exe = await tc.ensure('vrf');
  assert.ok(fs.existsSync(exe), 'the executable is on disk');
  assert.match(exe, /Source2Viewer-CLI\.exe$/);
  assert.equal(tc.pathOf('vrf'), exe, 'and it is found again without downloading');
  const state = tc.state().find((s) => s.name === 'vrf');
  assert.equal(state?.ready, true);
  assert.equal(state?.version, BUILT_IN_PINS.vrf.version);
  assert.ok(state && state.installedBytes > 0);
});

test('an archive that hashes to something else is not unpacked at all', async (t) => {
  await serve(t, toolZip());
  const dir = userDir(t);
  const tc = createToolchain({ userDataDir: dir });
  BUILT_IN_PINS.vrf.sha256 = 'f'.repeat(64); // what we pinned is not what arrived

  await assert.rejects(() => tc.ensure('vrf'), /checksum/);
  assert.equal(tc.pathOf('vrf'), null, 'nothing was installed');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'toolchain')).filter((f) => f.endsWith('.exe')), []);
});

test('an archive without the executable it promised is thrown away', async (t) => {
  const data = toolZip('SomethingElse.exe');
  await serve(t, data);
  const dir = userDir(t);
  const tc = createToolchain({ userDataDir: dir });
  BUILT_IN_PINS.vrf.sha256 = crypto.createHash('sha256').update(data).digest('hex');

  await assert.rejects(() => tc.ensure('vrf'), /Source2Viewer-CLI\.exe/);
  assert.equal(tc.pathOf('vrf'), null);
});

test('a tool nobody asked for is not a tool', async (t) => {
  const tc = createToolchain({ userDataDir: userDir(t) });
  await assert.rejects(() => tc.ensure('vpk'), /unknown tool/);
});

test('deleting a tool leaves nothing behind', async (t) => {
  const data = toolZip();
  await serve(t, data);
  const dir = userDir(t);
  const tc = createToolchain({ userDataDir: dir });
  BUILT_IN_PINS.vrf.sha256 = crypto.createHash('sha256').update(data).digest('hex');

  await tc.ensure('vrf');
  tc.remove('vrf');
  assert.equal(tc.pathOf('vrf'), null);
  assert.equal(fs.existsSync(path.join(dir, 'toolchain', 'vrf')), false);
  assert.equal(tc.state().find((s) => s.name === 'vrf')?.ready, false);
});

// The progress bar hides only when it hears 'done' or 'error'. Neither was sent, so the
// first-run download left "Downloading: vrf 50.3 / 50.3 MB" on screen for good.
test('a download tells the progress bar it is over, however it ends', async (t) => {
  const data = toolZip();
  await serve(t, data);
  const events: ToolProgress[] = [];
  const tc = createToolchain({ userDataDir: userDir(t), onProgress: (e) => events.push(e) });
  BUILT_IN_PINS.vrf.sha256 = crypto.createHash('sha256').update(data).digest('hex');
  await tc.ensure('vrf');
  assert.equal(events.at(-1)?.type, 'done');
  assert.equal(events.at(-1)?.label, 'vrf');

  const failed: ToolProgress[] = [];
  const tc2 = createToolchain({ userDataDir: userDir(t), onProgress: (e) => failed.push(e) });
  BUILT_IN_PINS.vrf.sha256 = 'f'.repeat(64);
  await assert.rejects(() => tc2.ensure('vrf'), /checksum/);
  const last = failed.at(-1);
  assert.equal(last?.type, 'error');
  assert.match(last?.type === 'error' ? last.message : '', /checksum/);
});

test('a tool that exits 0 settles, one that fails or hangs is an error, not a wait', async () => {
  await runTool(process.execPath, ['-e', 'process.exit(0)']);
  await assert.rejects(() => runTool(process.execPath, ['-e', 'process.exit(3)']));
  await assert.rejects(() => runTool(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 300 }),
    'a tool that never answers is given up on, so the picture it was asked for shows its placeholder');
});

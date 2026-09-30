/* Telling which catalog mod a VPK is from its content alone.
 *
 * This is how a file that arrived by hand, or sat in the game folder before the app did, gets
 * its catalog name back instead of showing up as "pak12". The map is fetched and cached; the
 * danger is in the cache: a damaged answer written over a good copy would leave every foreign
 * file unnamed until the next successful fetch.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import * as net from '../src/net.ts';
import { Fingerprints } from '../src/fingerprints.ts';

const GLADOS = { name: 'GLaDOS', categoryId: 'announcers' };
const RU_GLADOS = { name: 'Ru GLaDOS', categoryId: 'announcers' };
const HOOK = { name: 'Pudge Hook', categoryId: 'heroes', styleLabel: null };
const FONT = { name: 'Radiance', categoryId: 'fonts', files: { 'radiance.ttf': 'aa11', 'radiance-bold.ttf': 'bb22' } };

function userDir(t: TestContext, cached?: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-fp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (cached !== undefined) fs.writeFileSync(path.join(dir, 'fingerprints.json'), typeof cached === 'string' ? cached : JSON.stringify(cached));
  return dir;
}

/** Serves `body` as the published map, or refuses with `status`, for as long as the test runs. */
async function publish(t: TestContext, body: string, status = 200) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  const { port } = server.address() as AddressInfo;
  net.setMirrors([{ host: `127.0.0.1:${port}`, map: () => `http://127.0.0.1:${port}/fingerprints.json` }]);
  t.after(() => { server.close(); net.setMirrors(null); });
}

test('a print shared by two catalog entries names both of them', (t) => {
  const fps = new Fingerprints(userDir(t, { mods: { f00d: [GLADOS, RU_GLADOS] } }));
  assert.deepEqual(fps.match('f00d'), [GLADOS, RU_GLADOS]);
});

test('the older map with one identity per print is still read, as a list of one', (t) => {
  const fps = new Fingerprints(userDir(t, { mods: { beef: HOOK } }));
  assert.deepEqual(fps.match('beef'), [HOOK]);
});

test('a print nobody published, or no print at all, is no answer', (t) => {
  const fps = new Fingerprints(userDir(t, { mods: { beef: HOOK } }));
  assert.equal(fps.match('0000'), null);
  assert.equal(fps.match(''), null);
  assert.equal(fps.match(null), null);
});

test('a font mod counts only when every one of its files is there, byte for byte', (t) => {
  // font mods share panorama/fonts with the game's own files, so a folder is never theirs alone
  const fps = new Fingerprints(userDir(t, { mods: {}, fonts: [FONT] }));
  assert.deepEqual(fps.matchFonts({ 'radiance.ttf': 'aa11', 'radiance-bold.ttf': 'bb22', 'vanilla.ttf': 'ff' }), [FONT]);
  assert.deepEqual(fps.matchFonts({ 'radiance.ttf': 'aa11' }), [], 'half a font mod is not the mod');
  assert.deepEqual(fps.matchFonts({ 'radiance.ttf': 'aa11', 'radiance-bold.ttf': 'changed' }), [], 'an edited file is not the mod');
});

test('no map, or a damaged one, means nothing to match and no folder scan', (t) => {
  assert.equal(new Fingerprints(userDir(t)).hasData(), false);
  assert.equal(new Fingerprints(userDir(t, '{ not json')).hasData(), false);
  assert.equal(new Fingerprints(userDir(t, { fonts: [FONT] })).hasData(), true, 'fonts alone are something to match');
});

test('a fetched map is used at once and kept for the next start', async (t) => {
  await publish(t, JSON.stringify({ mods: { beef: [HOOK] } }));
  const dir = userDir(t);

  await new Fingerprints(dir).refresh();

  assert.deepEqual(new Fingerprints(dir).match('beef'), [HOOK], 'the next start read it from disk');
});

test('a damaged answer does not replace the copy that works', async (t) => {
  await publish(t, '<html>rate limited</html>');
  const dir = userDir(t, { mods: { beef: [HOOK] } });
  const fps = new Fingerprints(dir);

  await fps.refresh();

  assert.deepEqual(fps.match('beef'), [HOOK]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'fingerprints.json'), 'utf-8')), { mods: { beef: [HOOK] } });
});

test('no map hosted yet leaves the cache as it was', async (t) => {
  await publish(t, 'not found', 404);
  const fps = new Fingerprints(userDir(t, { mods: { beef: [HOOK] } }));

  assert.deepEqual(await fps.refresh(), { beef: [HOOK] });
});

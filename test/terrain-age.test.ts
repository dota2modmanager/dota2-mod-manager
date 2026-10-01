// Whole-map terrains against the game's own map (src/terrain-age.ts). Issue #122: a Dota+ Autumn
// built on 19 August over a map Valve changed on 3 September took the trees, two thirds of the
// frame rate and, after the next update, matchmaking.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { mapTimeInZip, mapTimeInArchive, isStale, createTerrainAges } from '../src/terrain-age.ts';

const DAY = 24 * 60 * 60 * 1000;
const AUG19 = new Date(2026, 7, 19, 9, 33, 46).getTime();
const SEP3 = new Date(2026, 8, 3, 22, 52, 56).getTime();

/** A terrain archive the way the catalog ships one: the map, and a guide beside it. */
function terrainZip(mapAt: number, { withMap = true, comment = '' }: { withMap?: boolean; comment?: string } = {}): Buffer {
  const zip = new AdmZip();
  zip.addFile('Guide.txt', Buffer.from('put maps/dota.vpk in your language folder'));
  if (withMap) {
    zip.addFile('maps/dota.vpk', Buffer.alloc(4096, 7));
    zip.getEntry('maps/dota.vpk')!.header.time = new Date(mapAt);
  }
  if (comment) zip.addZipComment(comment);
  return zip.toBuffer();
}

function sandbox(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-terrain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dota', 'maps'), { recursive: true });
  const map = path.join(game, 'dota', 'maps', 'dota.vpk');
  fs.writeFileSync(map, 'valve map');
  const setMap = (at: number) => fs.utimesSync(map, new Date(at), new Date(at));
  setMap(SEP3);
  const downloads = path.join(dir, 'downloads');
  fs.mkdirSync(path.join(downloads, 'terrains'), { recursive: true });
  return { dir, game, downloads, setMap };
}

/** A number read back, or NaN, which no closeness check passes. */
const num = (v: number | null | undefined): number => (typeof v === 'number' ? v : NaN);

/** A whole-map terrain record, with whatever a test changes in it. */
const terrain = (over: Record<string, unknown> = {}) => ({
  id: 'autumn', name: 'Dota+ Autumn', categoryId: 'terrains', fileRef: 'Autumn.zip', enabled: true,
  files: [{ root: 'lang', relPath: 'maps/dota.vpk' }], ...over,
});

test('the date the map was packed is read from the end of the archive, whole or cut', () => {
  const zip = terrainZip(AUG19, { comment: 'x'.repeat(3000) });
  // DOS time has two-second steps
  assert.ok(Math.abs(num(mapTimeInZip(zip)) - AUG19) < 2000);
  assert.ok(Math.abs(num(mapTimeInZip(zip.subarray(zip.length - 8192))) - AUG19) < 2000, 'the last bytes are enough');
  assert.equal(mapTimeInZip(terrainZip(AUG19, { withMap: false })), null, 'a pak terrain carries no map');
  assert.equal(mapTimeInZip(Buffer.from('not a zip at all, just bytes that go on for a while')), null);
  assert.equal(mapTimeInZip(null), null);
});

test('a terrain is old when it was built a day or more before the game\'s map', () => {
  assert.equal(isStale(AUG19, SEP3), true);
  assert.equal(isStale(SEP3 - 3 * 60 * 60 * 1000, SEP3), false, 'the same day: a zip keeps no time zone');
  assert.equal(isStale(SEP3 + DAY, SEP3), false);
  assert.equal(isStale(null, SEP3), false, 'unknown is not old');
  assert.equal(isStale(AUG19, null), false, 'no game map, nothing to compare against');
});

test('an installed terrain is dated by its record, or by its archive in the download cache', (t) => {
  const { game, downloads, dir } = sandbox(t);
  fs.writeFileSync(path.join(downloads, 'terrains', 'Autumn.zip'), terrainZip(AUG19));
  const ages = createTerrainAges({ downloadsDir: downloads, gamePath: () => game, storeFile: path.join(dir, 'store.json') });
  const out = ages.forRecords([
    terrain(),
    terrain({ id: 'fresh', fileRef: 'Gone.zip', mapBuiltAt: SEP3 + 2 * DAY }),
    terrain({ id: 'lost', fileRef: 'Gone.zip' }),
    { id: 'pak', name: 'A pak terrain', categoryId: 'terrains', files: [{ root: 'lang', relPath: 'pak12_dir.vpk' }] },
  ]);
  assert.equal(out.get('autumn')?.stale, true);
  assert.ok(Math.abs(num(out.get('autumn')?.builtAt) - AUG19) < 2000);
  assert.equal(out.get('fresh')?.stale, false, 'built after the map: the record says so');
  assert.equal(out.get('lost')?.stale, false, 'no record, no archive: not marked on a guess');
  assert.equal(out.has('pak'), false, 'a terrain on a pak leaves the map alone');
  assert.equal(ages.builtAtOf(terrain({ fileRef: '../../secret.zip' })), null, 'a file name is never a path');
  assert.ok(Math.abs(num(mapTimeInArchive(path.join(downloads, 'terrains', 'Autumn.zip'))) - AUG19) < 2000);
});

test('an old terrain is switched off once per map, and a choice to turn it back on is kept', (t) => {
  const { game, downloads, dir, setMap } = sandbox(t);
  fs.writeFileSync(path.join(downloads, 'terrains', 'Autumn.zip'), terrainZip(AUG19));
  const ages = createTerrainAges({ downloadsDir: downloads, gamePath: () => game, storeFile: path.join(dir, 'store.json') });
  const recs = [terrain(), terrain({ id: 'winter', name: 'Dota+ Winter', fileRef: 'Winter.zip', mapBuiltAt: AUG19, enabled: false })];
  const off: string[] = [];
  const switchOff = (rec: { id: string; enabled?: boolean }) => { off.push(rec.id); rec.enabled = false; };

  assert.deepEqual(ages.switchOffStale(recs, switchOff), ['Dota+ Autumn'], 'a switched-off one is not switched off again');
  assert.deepEqual(off, ['autumn']);

  recs[0].enabled = true; // the player turned it back on after being told
  assert.deepEqual(ages.switchOffStale(recs, switchOff), [], 'the same map: left alone');

  setMap(SEP3 + 20 * DAY); // Valve changes the map again
  assert.deepEqual(ages.switchOffStale(recs, switchOff), ['Dota+ Autumn']);
});

test('the catalog is asked about each terrain once, and again when its archive changes', async (t) => {
  const { game, downloads, dir } = sandbox(t);
  const archives: Record<string, Buffer> = { 'Autumn.zip': terrainZip(AUG19), 'Winter.zip': terrainZip(SEP3 + 2 * DAY) };
  let asked = 0;
  const hashes: Record<string, string> = { 'Autumn.zip': 'a1', 'Winter.zip': 'w1' };
  const ages = createTerrainAges({
    downloadsDir: downloads, gamePath: () => game, storeFile: path.join(dir, 'store.json'),
    fetchTail: async (categoryId, file) => {
      asked++;
      assert.equal(categoryId, 'terrains');
      const buf = archives[file];
      return buf.subarray(Math.max(0, buf.length - 4096));
    },
  });
  const catalog = [{ file: 'Autumn.zip' }, { file: 'Winter.zip' }, { file: 'pak12_dir.vpk' }];

  const first = await ages.forCatalog(catalog, (f) => hashes[f]);
  assert.deepEqual(first.stale, { 'Autumn.zip': true });
  assert.equal(asked, 2, 'a pak terrain is never fetched');

  await ages.forCatalog(catalog, (f) => hashes[f]);
  assert.equal(asked, 2, 'kept by the archive\'s published hash');

  archives['Autumn.zip'] = terrainZip(SEP3 + DAY * 2); // the author rebuilds it
  hashes['Autumn.zip'] = 'a2';
  const rebuilt = await ages.forCatalog(catalog, (f) => hashes[f]);
  assert.equal(asked, 3);
  assert.deepEqual(rebuilt.stale, {}, 'the new build is not old');
});

/* Updating a catalog mod to the catalog's current version (src/mod-update.ts), issue #171.
 *
 * Two promises. A mod counts as behind only when the catalog knows it and its installed file is
 * none of the catalog's own; four real installs checked on 2026-10-08 were all current, and a
 * false "new version" on every row would teach people to ignore the mark. And the update keeps
 * what the person set: the mod's slot in the load order and whether it is switched off.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { Fingerprints } from '../src/fingerprints.ts';
import { buildVpk, readVpkEntryFile } from '../src/vpk.ts';
import { behindCatalog, updatable, updateMod } from '../src/mod-update.ts';
import { entry } from './helpers/vpk-entry.ts';
import type { LibRecord } from '../src/types.ts';

const HUD = { categoryId: 'huds', name: 'Gotohouse Hud', styleLabel: null, fileRef: 'Gotohouse Hud.vpk', kind: undefined };

test('only a pak from the catalog can be behind it', () => {
  assert.equal(updatable(HUD), true);
  for (const categoryId of ['imported', 'cosmetic', 'fonts', 'cursors', 'tools']) assert.equal(updatable({ ...HUD, categoryId }), false, categoryId);
  assert.equal(updatable({ ...HUD, kind: 'pack' }), false);
  assert.equal(updatable({ ...HUD, fileRef: null }), false);
});

test('a mod is behind when the catalog knows it and its installed file is none of the catalog\'s own', () => {
  const prints = new Map([['huds\u0000Gotohouse Hud\u0000', new Set(['new-print'])]]);
  const printsOf = (id: { categoryId: string; name: string; styleLabel?: string | null }) => prints.get(`${id.categoryId}\u0000${id.name}\u0000${id.styleLabel || ''}`) || null;
  assert.equal(behindCatalog(HUD, 'old-print', printsOf), true);
  assert.equal(behindCatalog(HUD, 'new-print', printsOf), false, 'the same file is current');
  assert.equal(behindCatalog({ ...HUD, fpOriginal: 'new-print' }, 'repacked-print', printsOf), false, 'a repacked pak is matched on what it was');
  assert.equal(behindCatalog({ ...HUD, name: 'Unknown Hud' }, 'old-print', printsOf), false, 'a mod the index does not know is not called behind');
  assert.equal(behindCatalog(HUD, null, printsOf), false, 'nor is one whose file could not be read');
});

test('the fingerprint index answers which prints a catalog mod has, styles kept apart', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-prints-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fps = new Fingerprints(dir);
  fps.apply({ mods: {
    a1: [{ categoryId: 'huds', name: 'Gotohouse Hud' }],
    b1: [{ categoryId: 'huds', name: 'Gotohouse Hud', styleLabel: 'Dire' }],
    c1: { categoryId: 'huds', name: 'Gotohouse Hud' },
  } });
  assert.deepEqual([...(fps.printsOf({ categoryId: 'huds', name: 'Gotohouse Hud' }) || [])].sort(), ['a1', 'c1']);
  assert.deepEqual([...(fps.printsOf({ categoryId: 'huds', name: 'Gotohouse Hud', styleLabel: 'Dire' }) || [])], ['b1']);
  assert.equal(fps.printsOf({ categoryId: 'huds', name: 'Nobody' }), null);
  fps.apply({ mods: { d1: [{ categoryId: 'huds', name: 'Gotohouse Hud' }] } });
  assert.deepEqual([...(fps.printsOf({ categoryId: 'huds', name: 'Gotohouse Hud' }) || [])], ['d1'], 'a new index is read afresh');
});

/** A game folder with one catalog mod installed in pak34, and the catalog's newer file waiting. */
function world(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-update-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([entry('scripts/items/items_game.txt', 'the game')]));
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  const newer = path.join(dir, 'Gotohouse Hud.vpk');
  fs.writeFileSync(newer, buildVpk([entry('panorama/layout/hud/dota_hud.vxml_c', 'hud for 6952')]));
  let fetched = 0;
  installer.download = async () => { fetched++; return newer; };
  // a neighbour below it, so the free slot an install picks is not the old one
  fs.writeFileSync(path.join(lang, 'pak30_dir.vpk'), buildVpk([entry('materials/a.vtex_c', 'other mod')]));
  fs.writeFileSync(path.join(lang, 'pak34_dir.vpk'), buildVpk([entry('panorama/layout/hud/dota_hud.vxml_c', 'hud for 6944')]));
  const rec = library.add({ ...HUD, preview: null, files: [{ root: 'lang', relPath: 'pak34_dir.vpk' }] } as never) as LibRecord;
  return { lang, installer, library, rec, fetched: () => fetched };
}

const hudIn = (file: string) => readVpkEntryFile(file, 'panorama/layout/hud/dota_hud.vxml_c')?.data.toString();

test('an update puts the new file in the old slot, and nothing else is left behind', async (t) => {
  const w = world(t);
  const updated = await updateMod({ installer: w.installer, library: w.library, rec: w.rec });
  assert.deepEqual(updated.files, [{ root: 'lang', relPath: 'pak34_dir.vpk' }]);
  assert.equal(hudIn(path.join(w.lang, 'pak34_dir.vpk')), 'hud for 6952');
  assert.deepEqual(fs.readdirSync(w.lang).sort(), ['pak30_dir.vpk', 'pak34_dir.vpk'], 'no second copy in another slot');
  assert.equal(w.fetched(), 1);
});

test('a mod switched off stays off through the update', async (t) => {
  const w = world(t);
  fs.renameSync(path.join(w.lang, 'pak34_dir.vpk'), path.join(w.lang, 'pak34_dir.vpk.off'));
  w.library.update(w.rec.id, { enabled: false });
  await updateMod({ installer: w.installer, library: w.library, rec: w.library.find(w.rec.id) as LibRecord });
  assert.equal(fs.existsSync(path.join(w.lang, 'pak34_dir.vpk')), false);
  assert.equal(hudIn(path.join(w.lang, 'pak34_dir.vpk.off')), 'hud for 6952');
});

test('a download that fails leaves the installed version where it was', async (t) => {
  const w = world(t);
  w.installer.download = async () => { throw new Error('offline'); };
  await assert.rejects(updateMod({ installer: w.installer, library: w.library, rec: w.rec }), /offline/);
  assert.equal(hudIn(path.join(w.lang, 'pak34_dir.vpk')), 'hud for 6944');
  assert.deepEqual(w.library.find(w.rec.id)?.files, [{ root: 'lang', relPath: 'pak34_dir.vpk' }]);
});

test('an import is refused rather than guessed at', async (t) => {
  const w = world(t);
  await assert.rejects(updateMod({ installer: w.installer, library: w.library, rec: { ...w.rec, categoryId: 'imported' } }));
});

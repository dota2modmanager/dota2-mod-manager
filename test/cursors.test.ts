/* Which cursor set is live, and what the startup repair does about it.
 *
 * A cursor set writes loose files over Valve's own, so only one can be on and switching means
 * copying files back and forth rather than renaming a pak. The repair below runs on every
 * start and decides whether a user's cursor comes back after a game update, a Steam verify, or
 * another tool writing into the same folder. It had no test at all, because it lived in
 * main.js and main.js cannot be required: it pulls in Electron. Moving it into src/cursors.ts
 * is what these tests are for, and the order had to be that way round.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';

import vpk from '../src/vpk.js';
import installerJs from '../src/installer.js';
const { Installer } = installerJs;
import { Library } from '../src/library.ts';
import { createCursors } from '../src/cursors.ts';
import { settingsWith } from './helpers/settings.ts';

/** A settings store that answers only the game path, which is all the cursors ask it. */
const gameAt = (game: string | null) => settingsWith({ dotaGamePath: game });

const ARROW = 'arrow.ani';
const VANILLA = 'valve\'s own arrow';

/** A game folder the installer accepts, a real library, and the cursor functions over both. */
function stand(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-cursors-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const live = path.join(game, 'dota', 'resource', 'cursor');
  fs.mkdirSync(live, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), 'the game\'s own archive');
  fs.writeFileSync(path.join(live, ARROW), VANILLA);

  const userDataDir = path.join(dir, 'userdata');
  const installer = new Installer({
    userDataDir,
    getGamePath: () => game,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });
  const library = new Library(userDataDir);
  const settings = gameAt(game);
  const cursors = createCursors({ installer, library, settings });

  /** An installed cursor set: a library record plus the copy installing one leaves behind. */
  const cursorSet = (name: string, bytes: string | null, { stored = true }: { stored?: boolean } = {}) => {
    const files = [{ root: 'cursor', relPath: ARROW }];
    const rec = library.add({ name, categoryId: 'cursors', styleLabel: null, fileRef: null, preview: null, files });
    if (stored) {
      const store = installer.cursorStoreDir(rec.id);
      fs.mkdirSync(store, { recursive: true });
      fs.writeFileSync(path.join(store, ARROW), bytes ?? '');
    }
    return rec;
  };

  /** What the game would draw right now. */
  const onDisk = () => fs.readFileSync(path.join(live, ARROW), 'utf-8');

  return { dir, game, live, installer, library, settings, cursors, cursorSet, onDisk };
}

test('one cursor set coming on takes the others off, and says which gave way', (t) => {
  const { cursors, library, cursorSet } = stand(t);
  const mine = cursorSet('Mine', 'my arrow');
  const theirs = cursorSet('Theirs', 'their arrow');

  const off = cursors.disableOtherCursors(mine.id);

  assert.deepEqual(off, ['Theirs']);
  assert.equal(library.find(theirs.id)?.enabled, false);
  assert.equal(library.find(mine.id)?.enabled, true, 'the set being switched on was switched off');
});

test('a set that is already off is not reported as having given way', (t) => {
  /* The names come back to the user as "replaced X". Listing a set that was off for days is a
     report of something that did not happen. */
  const { cursors, library, cursorSet } = stand(t);
  const mine = cursorSet('Mine', 'my arrow');
  const old = cursorSet('Old', 'an old arrow');
  library.setEnabled(old.id, false);

  assert.deepEqual(cursors.disableOtherCursors(mine.id), []);
});

test('a slot wears one look: the sibling is switched off, another slot is left alone', (t) => {
  const { cursors, library } = stand(t);
  const add = (name: string) => library.add({
    name, categoryId: 'cosmetic', styleLabel: null, fileRef: null, preview: null, files: [],
  });
  const courier = add('Courier A');
  const sibling = add('Courier B');
  const ward = add('Ward A');
  library.update(courier.id, { slot: 'courier' });
  library.update(sibling.id, { slot: 'courier' });
  library.update(ward.id, { slot: 'ward' });

  const off = cursors.disableOtherCosmetics(library.find(courier.id)!);

  assert.deepEqual(off, ['Courier B']);
  assert.equal(library.find(sibling.id)?.enabled, false);
  assert.equal(library.find(ward.id)?.enabled, true, 'a different slot was switched off with it');
});

test('mods off puts the game\'s own cursor back, and mods on brings the set again', (t) => {
  /* The master switch renames paks, which does nothing to a cursor: without this, "mods off"
     left the user's cursor on screen and looked like the switch had not worked. */
  const { cursors, installer, cursorSet, onDisk } = stand(t);
  const rec = cursorSet('Mine', 'my arrow');
  installer.deployCursor(rec.id, rec.files);
  assert.equal(onDisk(), 'my arrow');

  cursors.applyMasterToCursors(false);
  assert.equal(onDisk(), VANILLA, 'mods off left the mod\'s cursor on screen');

  cursors.applyMasterToCursors(true);
  assert.equal(onDisk(), 'my arrow');
});

test('the repair puts the switched-on set back on disk', (t) => {
  /* A game update or a Steam verify rewrites the cursor folder without telling anyone. The
     record still says the mod is on; this is what makes that true again. */
  const { cursors, cursorSet, onDisk } = stand(t);
  cursorSet('Mine', 'my arrow');
  assert.equal(onDisk(), VANILLA, 'nothing is deployed yet');

  cursors.reconcileCursors();

  assert.equal(onDisk(), 'my arrow');
});

test('a set installed before there was a store keeps the copy that is live', (t) => {
  /* Records made before cursors could be switched off have no stored copy. What is on disk IS
     that set, so the repair adopts it; otherwise switching it off later would have nothing to
     put back and nothing to restore. */
  const { cursors, installer, cursorSet, live } = stand(t);
  fs.writeFileSync(path.join(live, ARROW), 'the set that is already on');
  const rec = cursorSet('Old', null, { stored: false });

  cursors.reconcileCursors();

  const stored = path.join(installer.cursorStoreDir(rec.id), ARROW);
  assert.ok(fs.existsSync(stored), 'the live set was not kept anywhere');
  assert.equal(fs.readFileSync(stored, 'utf-8'), 'the set that is already on');
});

test('with several sets marked on and nothing stored, only the newest keeps the claim', (t) => {
  /* The legacy case: more than one set marked on at once, when only the newest was ever really
     on disk. Adopting the live files for both would file the same bytes under two mods. */
  const { cursors, library, installer, cursorSet, live } = stand(t);
  fs.writeFileSync(path.join(live, ARROW), 'whatever is actually on');
  const older = cursorSet('Older', null, { stored: false });
  const newer = cursorSet('Newer', null, { stored: false });
  library.update(older.id, { installedAt: 1 });
  library.update(newer.id, { installedAt: 2 });

  cursors.reconcileCursors();

  assert.ok(fs.existsSync(path.join(installer.cursorStoreDir(newer.id), ARROW)), 'the newest set kept nothing');
  assert.equal(fs.existsSync(installer.cursorStoreDir(older.id)), false, 'the older set claimed the same bytes');
  assert.equal(library.find(older.id)?.enabled, false, 'the older set still says it is on');
  assert.equal(library.find(newer.id)?.enabled, true);
});

test('a set with no copy anywhere is switched off instead of claiming to be on', (t) => {
  /* Nothing of it is kept and nothing of it is live: it can only come back by reinstalling, and
     a record that says otherwise is a switch that does nothing when the user flips it. */
  const { cursors, library, cursorSet, live } = stand(t);
  fs.rmSync(path.join(live, ARROW), { force: true });
  const rec = cursorSet('Gone', null, { stored: false });

  cursors.reconcileCursors();

  assert.equal(library.find(rec.id)?.enabled, false);
});

test('with the master switch off the repair leaves the folder vanilla', (t) => {
  const { cursors, installer, library, cursorSet, onDisk } = stand(t);
  const rec = cursorSet('Mine', 'my arrow');
  installer.deployCursor(rec.id, rec.files);
  // a mod pak has to exist for the master switch to have anything to rename
  const lang = installer.langFolder();
  fs.writeFileSync(path.join(lang, 'pak10_dir.vpk'), vpk.buildVpk([{
    ext: 'vmdl_c', folder: 'models', name: 'x', data: Buffer.from('m'), preload: Buffer.alloc(0), crc: crc32(Buffer.from('m')) >>> 0,
  }]));
  installer.setMasterEnabled(false);
  assert.equal(installer.masterIsOff(), true, 'the stand did not manage to switch the master off');

  cursors.reconcileCursors();

  assert.equal(onDisk(), VANILLA, 'mods are off and the mod\'s cursor is on screen');
  assert.equal(library.find(rec.id)?.enabled, true, 'master off is not the same as switching the mod off');
});

test('no game path means nothing is touched', (t) => {
  const { installer, library, cursorSet, onDisk } = stand(t);
  const rec = cursorSet('Mine', 'my arrow');
  const cursors = createCursors({ installer, library, settings: gameAt(null) });

  cursors.reconcileCursors();

  assert.equal(onDisk(), VANILLA);
  assert.equal(library.find(rec.id)?.enabled, true);
});

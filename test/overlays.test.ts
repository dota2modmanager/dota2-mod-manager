/* Fonts and cursors: loose files written over the game's own, and everything that keeps that
 * reversible.
 *
 * test/installer.test.ts covers the same ground through the installer, which is how the app
 * reaches it. These hold src/overlays.ts on its own: what is kept as the game's original, what
 * counts as undone by Steam's file check, and how a cursor set is put on and taken off.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

import { Overlays } from '../src/overlays.ts';
import type { LibRecord } from '../src/types.ts';

const sha1 = (s: string | Buffer) => crypto.createHash('sha1').update(s).digest('hex');

/** A game with Valve's own font and cursor, and the folders the overlays keep their copies in. */
function stand(t: TestContext, { game = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-overlays-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gamePath = path.join(root, 'game');
  const fonts = path.join(gamePath, 'dota', 'panorama', 'fonts');
  const cursor = path.join(gamePath, 'dota', 'resource', 'cursor');
  fs.mkdirSync(fonts, { recursive: true });
  fs.mkdirSync(cursor, { recursive: true });
  fs.writeFileSync(path.join(fonts, 'radiance.otf'), 'valve font');
  fs.writeFileSync(path.join(cursor, 'cursor_default.bmp'), 'valve cursor');
  const archives = new Map<string, string>();
  const overlays = new Overlays({
    getGamePath: () => (game ? gamePath : null),
    backupsDir: path.join(root, 'backups'),
    cursorsDir: path.join(root, 'cursors'),
    cachedArchive: (categoryId, fileRef) => archives.get(`${categoryId}/${fileRef}`) || null,
  });
  /** An archive on disk, shaped the way the catalog ships it. */
  const archive = (name: string, files: Record<string, string>) => {
    const zip = new AdmZip();
    for (const [rel, body] of Object.entries(files)) zip.addFile(rel, Buffer.from(body));
    const file = path.join(root, `${name}.zip`);
    zip.writeZip(file);
    return file;
  };
  return { root, gamePath, fonts, cursor, overlays, archive, archives };
}

const record = (over: Partial<LibRecord>): LibRecord => ({ id: 'r1', name: 'Mod', categoryId: 'fonts', files: [], ...over });

test("a font goes over the game's own, and the game's copy is kept once", (t) => {
  const s = stand(t);
  const zip = s.archive('Nice Font', { 'Nice Font/assets/custom/radiance.otf': 'nice', 'Nice Font/assets/default/radiance.otf': 'valve font' });

  const files = s.overlays.installFonts(zip, 'Nice Font');

  assert.deepEqual(files, [{ root: 'fonts', relPath: 'radiance.otf' }]);
  assert.equal(fs.readFileSync(path.join(s.fonts, 'radiance.otf'), 'utf-8'), 'nice');
  assert.equal(fs.readFileSync(path.join(s.root, 'backups', 'fonts', 'radiance.otf'), 'utf-8'), 'valve font');
  assert.equal(s.overlays.written()['fonts/radiance.otf'], sha1('nice'), 'the write is recorded by its hash');

  // installed again, the file on disk is the mod's own write, and is not kept as Valve's
  s.overlays.installFonts(zip, 'Nice Font');
  assert.equal(fs.readFileSync(path.join(s.root, 'backups', 'fonts', 'radiance.otf'), 'utf-8'), 'valve font');
});

test('an archive without what its kind needs is refused by name', (t) => {
  const s = stand(t);
  const zip = s.archive('Empty', { 'Empty/readme.txt': 'hi' });
  assert.throws(() => s.overlays.installFonts(zip, 'Empty'), /Empty/);
  assert.throws(() => s.overlays.installCursor(zip, 'Empty'), /Empty/);
});

test('without a game there is nowhere to write, and it says so', (t) => {
  const s = stand(t, { game: false });
  assert.throws(() => s.overlays.liveDir('fonts'), /Dota 2/);
  assert.equal(s.overlays.fontFolderHashes(), null);
  assert.deepEqual(s.overlays.lostToVerify([record({ files: [{ root: 'fonts', relPath: 'radiance.otf' }] })]), []);
});

test("a file Steam's check put back is noticed, and one the app wrote is not", (t) => {
  const s = stand(t);
  const f = { root: 'fonts', relPath: 'radiance.otf' };
  s.overlays.installFonts(s.archive('Nice', { 'Nice/assets/custom/radiance.otf': 'nice' }), 'Nice');
  assert.equal(s.overlays.vanillaIsBack(f), false, 'the mod is on');

  fs.writeFileSync(path.join(s.fonts, 'radiance.otf'), 'valve font');   // what a verify does
  assert.equal(s.overlays.vanillaIsBack(f), true);
  assert.deepEqual(s.overlays.lostToVerify([record({ files: [f] }), record({ id: 'off', enabled: false, files: [f] })]).map((r) => r.id), ['r1'],
    'a switched-off mod is not reported as undone');

  fs.rmSync(path.join(s.fonts, 'radiance.otf'));
  assert.equal(s.overlays.vanillaIsBack(f), true, 'a file that is gone was taken back too');
  assert.equal(s.overlays.vanillaIsBack({ root: 'lang', relPath: 'pak10_dir.vpk' }), false, 'a pak is not an overlay');
});

test("a mod that ships one of Valve's files unchanged is not taken for undone", (t) => {
  /* Nothing Font carries Valve's own file byte for byte. Compared with the backup alone it
     looked undone the moment it went in, and was written out again at every start. */
  const s = stand(t);
  s.overlays.installFonts(s.archive('Nothing', { 'Nothing/assets/custom/radiance.otf': 'valve font' }), 'Nothing');
  assert.equal(s.overlays.vanillaIsBack({ root: 'fonts', relPath: 'radiance.otf' }), false);
});

test('a file the game never had is left alone by a verify, so it is never reported', (t) => {
  const s = stand(t);
  s.overlays.installFonts(s.archive('Extra', { 'Extra/assets/custom/extra.otf': 'new' }), 'Extra');
  s.overlays.noteWritten('fonts', [['extra.otf', null]]);   // an install from before writes were recorded
  assert.equal(s.overlays.vanillaIsBack({ root: 'fonts', relPath: 'extra.otf' }), false);
});

test('a cursor set goes on from its own copy and comes off with the vanilla file back', (t) => {
  const s = stand(t);
  const zip = s.archive('Sword', { 'Sword/cursor/cursor_default.bmp': 'sword', 'Sword/cursor/cursor_extra.bmp': 'extra' });
  const files = s.overlays.installCursor(zip, 'Sword');
  assert.equal(s.overlays.ensureCursorStore('sword', files), true, 'the set is kept in userData');
  assert.equal(s.overlays.ensureCursorStore('sword', files), true, 'and kept once');

  s.overlays.undeployCursor('sword', files);
  assert.equal(fs.readFileSync(path.join(s.cursor, 'cursor_default.bmp'), 'utf-8'), 'valve cursor');
  assert.equal(fs.existsSync(path.join(s.cursor, 'cursor_extra.bmp')), false, 'a file Valve has no copy of is dropped');
  assert.deepEqual(s.overlays.written(), {}, 'nothing is remembered about files that are gone');

  assert.equal(s.overlays.deployCursor('sword', files), 2);
  assert.equal(fs.readFileSync(path.join(s.cursor, 'cursor_default.bmp'), 'utf-8'), 'sword');
  assert.equal(s.overlays.deployCursor('sword', files), 2, 'a second deploy over itself changes nothing');
  assert.equal(fs.readFileSync(path.join(s.root, 'backups', 'cursor', 'cursor_default.bmp'), 'utf-8'), 'valve cursor',
    'and does not take the set for the vanilla file');
});

test('a cursor set packs back into the layout the catalog ships', (t) => {
  const s = stand(t);
  const files = s.overlays.installCursor(s.archive('Sword', { 'Sword/cursor/cursor_default.bmp': 'sword' }), 'Sword');
  s.overlays.ensureCursorStore('sword', files);

  const zip = new AdmZip(s.overlays.cursorZip({ id: 'sword', name: 'Sword: <v2>', files }));
  assert.deepEqual(zip.getEntries().map((e) => e.entryName), ['Sword_ _v2_/cursor/cursor_default.bmp'],
    'a name Windows cannot hold becomes one it can');

  s.overlays.dropCursorStore('sword');
  s.overlays.dropCursorStore(null);
  fs.rmSync(path.join(s.cursor, 'cursor_default.bmp'));
  assert.throws(() => s.overlays.cursorZip({ id: 'sword', name: 'Sword', files }), /курсора|cursor/i);
  assert.throws(() => s.overlays.deployCursor('sword', files), /курсора|cursor/i);
});

test('an undone mod comes back from where it can, and says where from', (t) => {
  const s = stand(t);
  const cursorFiles = s.overlays.installCursor(s.archive('Sword', { 'Sword/cursor/cursor_default.bmp': 'sword' }), 'Sword');
  s.overlays.ensureCursorStore('sword', cursorFiles);
  assert.equal(s.overlays.restoreDeployed(record({ id: 'sword', files: cursorFiles })), 'store');

  const font = record({ id: 'font', categoryId: 'fonts', fileRef: 'Nice.zip', name: 'Nice', files: [{ root: 'fonts', relPath: 'radiance.otf' }] });
  assert.equal(s.overlays.restoreDeployed(font), null, 'no download to restore from: that needs the network');
  s.archives.set('fonts/Nice.zip', s.archive('Nice', { 'Nice/assets/custom/radiance.otf': 'nice' }));
  assert.equal(s.overlays.restoreDeployed(font), 'cache');
  assert.equal(fs.readFileSync(path.join(s.fonts, 'radiance.otf'), 'utf-8'), 'nice');
});

test('the font folder is fingerprinted file by file, under lower-case names', (t) => {
  const s = stand(t);
  fs.mkdirSync(path.join(s.fonts, 'sub'));
  fs.writeFileSync(path.join(s.fonts, 'sub', 'Radiance-Bold.OTF'), 'bold');
  assert.deepEqual(s.overlays.fontFolderHashes(), {
    'radiance.otf': sha1('valve font'),
    'radiance-bold.otf': sha1('bold'),
  });
  fs.rmSync(s.fonts, { recursive: true });
  assert.equal(s.overlays.fontFolderHashes(), null, 'no folder, nothing to match against');
});

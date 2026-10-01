/* The part of src/installer.ts that writes a mod into the game and takes it out again.
 *
 * On 2026-09-16 a third of this file had no unit test at all: installInto, the font, cursor and
 * tool installs, switching a mod off, removing it, the clean-up after a killed transaction, and
 * the check for files Steam's verify put back. The window test (tools/e2e.mjs) clicks through a
 * catalog install, so the common path was covered from outside; everything that path does not
 * reach was covered by nothing. These call the same methods against a throwaway game folder.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Thrown } from './helpers/thrown.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { Installer } from '../src/installer.ts';
import { FileTx } from '../src/file-tx.ts';
import { Library } from '../src/library.ts';
import { vacateAppPak } from '../src/slot-zones.ts';
import rawZipJs from './fixtures/raw-zip.js';
const { rawZip } = rawZipJs;

const FONTS = ['dota', 'panorama', 'fonts'];
const CURSOR = ['dota', 'resource', 'cursor'];

/** A game folder the installer accepts, and an installer pointed at it. */
function stand(t: TestContext, { game: withGame = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-installer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), "the game's own archive");
  const installer = new Installer({
    userDataDir: path.join(dir, 'userdata'),
    getGamePath: () => (withGame ? game : null),
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });
  const lang = path.join(game, 'dota_russian');
  const incoming = path.join(dir, 'incoming');
  fs.mkdirSync(incoming);
  /** A file as the download step would leave it. */
  const arrive = (name: string, body: string | Buffer) => {
    const p = path.join(incoming, name);
    fs.writeFileSync(p, body);
    return p;
  };
  const zip = (name: string, entries: [string, string][]) => {
    const z = new AdmZip();
    for (const [inner, body] of entries) z.addFile(inner, Buffer.from(body));
    return arrive(name, z.toBuffer());
  };
  const read = (...parts: string[]) => fs.readFileSync(path.join(game, ...parts), 'utf-8');
  const has = (...parts: string[]) => fs.existsSync(path.join(game, ...parts));
  return { dir, game, lang, installer, arrive, zip, read, has };
}

/** What stand() hands a test. */
type Stand = ReturnType<typeof stand>;

const install = (installer: Installer, categoryId: string, local: string, modName = 'Test Mod') =>
  FileTx.run((tx) => installer.installInto(tx, { categoryId, modName, local }));

// ---------- into the language folder ----------

test('a single VPK takes the first free slot, and a category that must load early takes a low one', (t) => {
  const s = stand(t);
  assert.deepEqual(install(s.installer, 'heroes', s.arrive('Axe.vpk', 'axe')), [{ root: 'lang', relPath: 'pak30_dir.vpk' }]);
  assert.deepEqual(install(s.installer, 'heroes', s.arrive('Lina.vpk', 'lina')), [{ root: 'lang', relPath: 'pak31_dir.vpk' }]);
  assert.deepEqual(install(s.installer, 'trees', s.arrive('Trees.vpk', 'trees')), [{ root: 'lang', relPath: 'pak02_dir.vpk' }]);
  assert.equal(s.read('dota_russian', 'pak30_dir.vpk'), 'axe');
  assert.equal(s.read('dota_russian', 'pak02_dir.vpk'), 'trees');
});

test('an archive keeps its volume sets whole, its maps where the game reads them, and drops the guide', (t) => {
  const s = stand(t);
  const local = s.zip('Arcana.zip', [
    ['Arcana/pak01_dir.vpk', 'index'],
    ['Arcana/pak01_000.vpk', 'volume'],
    ['Arcana/extra.vpk', 'second mod'],
    ['Arcana/maps/dota.vpk', 'terrain'],
    ['Arcana/particles/custom.vpcf_c', 'loose file'],
    ['Arcana/readme.txt', 'how to install'],
    ['Arcana/install.bat', 'copy *.*'],
    ['Arcana/!guide/step1.png', 'picture'],
  ]);

  const records = install(s.installer, 'heroes', local, 'Arcana');
  const paks = records.map((r) => r.relPath).filter((p) => p.startsWith('pak'));
  assert.deepEqual(paks.map((p) => p.replace(/^pak\d+/, 'pakNN')).sort(), ['pakNN_000.vpk', 'pakNN_dir.vpk', 'pakNN_dir.vpk']);
  assert.deepEqual([...new Set(paks.map((p) => p.slice(0, 5)))].sort(), ['pak30', 'pak31'], 'two sets, two slots');
  // which set takes 30 follows the archive's own order; the index and its volume share one
  const index = paks.find((p) => s.read('dota_russian', p) === 'index');
  assert.ok(index, 'the index was written');
  assert.equal(s.read('dota_russian', index.replace('_dir.vpk', '_000.vpk')), 'volume', 'the volume moved with its index');
  assert.deepEqual(records.map((r) => r.relPath).filter((p) => !p.startsWith('pak')).sort(), ['maps/dota.vpk', 'particles/custom.vpcf_c']);
  assert.equal(s.read('dota_russian', 'maps', 'dota.vpk'), 'terrain');
  assert.equal(s.read('dota_russian', 'particles', 'custom.vpcf_c'), 'loose file', 'the archive folder is not repeated');
  for (const gone of ['readme.txt', 'install.bat', '!guide']) {
    assert.equal(s.has('dota_russian', gone), false, `${gone} reached the game folder`);
  }
});

test('a file that is neither an archive nor a VPK is dropped into the folder under its own name', (t) => {
  const s = stand(t);
  assert.deepEqual(install(s.installer, 'heroes', s.arrive('config.cfg', 'cfg')), [{ root: 'lang', relPath: 'config.cfg' }]);
  assert.equal(s.read('dota_russian', 'config.cfg'), 'cfg');
});

test('an archive that breaks halfway leaves nothing behind', (t) => {
  /* One transaction around the whole install: the first file is written, the second turns out
     to be damaged, and the first has to go again, or the game mounts half a mod the library has
     no record of. */
  const s = stand(t);
  const first = { name: 'Mod/pak01_dir.vpk', data: Buffer.from('good index') };
  const second = { name: 'Mod/particles/fx.vpcf_c', data: Buffer.from('damaged bytes') };
  const buf = rawZip([first, second]);
  buf[30 + first.name.length + first.data.length + 30 + second.name.length] ^= 0xff;
  const local = s.arrive('Broken.zip', buf);

  assert.throws(() => install(s.installer, 'heroes', local, 'Broken'), (err: Thrown) => err.safeZip === true);
  assert.deepEqual(fs.readdirSync(s.lang).filter((f) => f !== 'gameinfo.gi'), []);
});

// ---------- fonts, cursors, tools ----------

test("a font goes over the game's own, which is kept once and put back on removal", (t) => {
  const s = stand(t);
  fs.mkdirSync(path.join(s.game, ...FONTS), { recursive: true });
  fs.writeFileSync(path.join(s.game, ...FONTS, 'radiance.ttf'), 'valve font');
  const first = s.zip('Font A.zip', [['Font A/assets/custom/radiance.ttf', 'font A'], ['Font A/assets/default/radiance.ttf', 'valve font']]);
  const second = s.zip('Font B.zip', [['Font B/assets/custom/radiance.ttf', 'font B']]);

  const records = install(s.installer, 'fonts', first, 'Font A');
  assert.deepEqual(records, [{ root: 'fonts', relPath: 'radiance.ttf' }]);
  assert.equal(s.read(...FONTS, 'radiance.ttf'), 'font A');
  install(s.installer, 'fonts', second, 'Font B');
  assert.equal(
    fs.readFileSync(path.join(s.installer.backupsDir, 'fonts', 'radiance.ttf'), 'utf-8'), 'valve font',
    'the second font would otherwise be kept as the original',
  );

  s.installer.remove(records);
  assert.equal(s.read(...FONTS, 'radiance.ttf'), 'valve font');
});

test('a font archive without assets/custom is refused by name', (t) => {
  const s = stand(t);
  const local = s.zip('Wrong.zip', [['Wrong/fonts/radiance.ttf', 'x']]);
  assert.throws(() => install(s.installer, 'fonts', local, 'Wrong Font'), /Wrong Font/);
});

test('a cursor set is installed over the game, packed back into the catalog layout, and removed', (t) => {
  const s = stand(t);
  fs.mkdirSync(path.join(s.game, ...CURSOR), { recursive: true });
  fs.writeFileSync(path.join(s.game, ...CURSOR, 'cursor_default.bmp'), 'valve cursor');
  const local = s.zip('Neon.zip', [['Neon/cursor/cursor_default.bmp', 'neon'], ['Neon/cursor/cursor_spell.bmp', 'neon spell']]);

  const files = install(s.installer, 'cursors', local, 'Neon');
  assert.deepEqual(files.map((f) => f.relPath).sort(), ['cursor_default.bmp', 'cursor_spell.bmp']);
  assert.equal(s.read(...CURSOR, 'cursor_default.bmp'), 'neon');

  const packed = new AdmZip(s.installer.cursorZip({ id: 'neon', name: 'Neon', files }));
  assert.deepEqual(packed.getEntries().map((e) => e.entryName).sort(), ['Neon/cursor/cursor_default.bmp', 'Neon/cursor/cursor_spell.bmp']);

  s.installer.remove(files, { recId: 'neon' });
  assert.equal(s.read(...CURSOR, 'cursor_default.bmp'), 'valve cursor');
  assert.equal(s.has(...CURSOR, 'cursor_spell.bmp'), false, 'a file Valve does not ship is simply gone');
  assert.deepEqual(s.installer.overlays.written(), {}, 'nothing is remembered about files that are gone');

  const ghost = { id: 'ghost', name: 'Ghost', files: [{ root: 'cursor', relPath: 'cursor_ghost.bmp' }] };
  assert.throws(() => s.installer.cursorZip(ghost), /курсора|cursor/i, 'a set with no file anywhere cannot be packed');
});

test('a cursor archive without a cursor folder is refused by name', (t) => {
  const s = stand(t);
  const local = s.zip('Nope.zip', [['Nope/pointer.bmp', 'x']]);
  assert.throws(() => install(s.installer, 'cursors', local, 'Nope Cursor'), /Nope Cursor/);
});

test('fonts and cursors need a game path, and say so', (t) => {
  const s = stand(t, { game: false });
  const local = s.zip('Font.zip', [['Font/assets/custom/a.ttf', 'x']]);
  assert.throws(() => s.installer.overlays.installFonts(local, 'Font'), /Dota 2/);
  assert.throws(() => s.installer.overlays.installCursor(local, 'Font'), /Dota 2/);
});

test('a tool is unpacked into its own folder in the app, needs no game, and is removed whole', (t) => {
  const s = stand(t, { game: false });
  const local = s.zip('VPK Tool.zip', [['bin/tool.exe', 'exe'], ['readme.txt', 'read me']]);
  const records = install(s.installer, 'tools', local, 'VPK: Tool');
  assert.deepEqual(records, [{ root: 'tools', relPath: 'VPK_ Tool' }]);
  const dir = path.join(s.installer.toolsDir, 'VPK_ Tool');
  assert.equal(fs.readFileSync(path.join(dir, 'bin', 'tool.exe'), 'utf-8'), 'exe');

  const single = install(s.installer, 'tools', s.arrive('helper.exe', 'single'), 'Helper');
  assert.equal(fs.readFileSync(path.join(s.installer.toolsDir, 'Helper', 'helper.exe'), 'utf-8'), 'single');

  s.installer.remove(records);
  assert.equal(fs.existsSync(dir), false);
  assert.ok(fs.existsSync(path.join(s.installer.toolsDir, single[0].relPath)), 'the other tool stays');
});

// ---------- on, off, gone ----------

test('switching a mod off renames its files, on renames them back, and fonts are left alone', (t) => {
  const s = stand(t);
  const files = install(s.installer, 'heroes', s.zip('Two.zip', [['Two/pak01_dir.vpk', 'i'], ['Two/pak01_000.vpk', 'v']]));
  const withFont = [...files, { root: 'fonts', relPath: 'radiance.ttf' }, { root: 'tools', relPath: 'Tool' }];

  s.installer.setEnabled(withFont, false);
  assert.deepEqual(fs.readdirSync(s.lang).filter((f) => f.startsWith('pak')).sort(), ['pak30_000.vpk.off', 'pak30_dir.vpk.off']);
  s.installer.setEnabled(withFont, false);
  assert.ok(s.has('dota_russian', 'pak30_dir.vpk.off'), 'switching off twice changes nothing');

  s.installer.setEnabled(withFont, true);
  assert.deepEqual(fs.readdirSync(s.lang).filter((f) => f.startsWith('pak')).sort(), ['pak30_000.vpk', 'pak30_dir.vpk']);
});

test('removing a mod deletes it whether it is on, off or switched off by the master switch', (t) => {
  const s = stand(t);
  const a = install(s.installer, 'heroes', s.arrive('A.vpk', 'a'));
  const b = install(s.installer, 'heroes', s.arrive('B.vpk', 'b'));
  const c = install(s.installer, 'heroes', s.arrive('C.vpk', 'c'));
  s.installer.setEnabled(b, false);
  fs.renameSync(path.join(s.lang, c[0].relPath), path.join(s.lang, `${c[0].relPath}.moff`));

  s.installer.remove([...a, ...b, ...c]);
  assert.deepEqual(fs.readdirSync(s.lang).filter((f) => f.startsWith('pak')), []);
});

test('a switched-off cursor set is removed without putting the vanilla file over its replacement', (t) => {
  const s = stand(t);
  fs.mkdirSync(path.join(s.game, ...CURSOR), { recursive: true });
  fs.writeFileSync(path.join(s.game, ...CURSOR, 'cursor_default.bmp'), 'another set');
  fs.mkdirSync(path.join(s.installer.backupsDir, 'cursor'), { recursive: true });
  fs.writeFileSync(path.join(s.installer.backupsDir, 'cursor', 'cursor_default.bmp'), 'valve cursor');

  s.installer.remove([{ root: 'cursor', relPath: 'cursor_default.bmp' }], { recId: 'old', deployed: false });
  assert.equal(s.read(...CURSOR, 'cursor_default.bmp'), 'another set');
});

test('an unknown root is an error, not a guess', (t) => {
  const s = stand(t);
  assert.throws(() => s.installer.rootAbs('somewhere'), /somewhere/);
});

// ---------- after the app was killed mid-write ----------

test('a parked file whose original is missing is put back, and an old leftover is dropped', (t) => {
  const s = stand(t);
  fs.mkdirSync(s.lang, { recursive: true });
  // an interrupted switch-off: the file was parked and the app died before the rename landed
  fs.writeFileSync(path.join(s.lang, 'pak10_dir.vpk.a1b2.mmtx'), 'the mod');
  // a finished write whose old copy was never cleaned up, a fortnight ago
  fs.writeFileSync(path.join(s.lang, 'pak11_dir.vpk'), 'new');
  const stale = path.join(s.lang, 'pak11_dir.vpk.c3d4.mmtx');
  fs.writeFileSync(stale, 'old');
  const fortnight = (Date.now() - 14 * 24 * 3600 * 1000) / 1000;
  fs.utimesSync(stale, fortnight, fortnight);
  // the same, yesterday: kept a while in case somebody wants it
  fs.writeFileSync(path.join(s.lang, 'pak12_dir.vpk'), 'new');
  fs.writeFileSync(path.join(s.lang, 'pak12_dir.vpk.e5f6.mmtx'), 'old');

  assert.deepEqual(s.installer.sweepStaged(), { restored: 1, dropped: 1 });
  assert.equal(s.read('dota_russian', 'pak10_dir.vpk'), 'the mod');
  assert.equal(fs.existsSync(stale), false);
  assert.ok(s.has('dota_russian', 'pak12_dir.vpk.e5f6.mmtx'));
});

test('with no game path there is nothing to sweep', (t) => {
  const s = stand(t, { game: false });
  assert.deepEqual(s.installer.sweepStaged(), { restored: 0, dropped: 0 });
});

// ---------- after Steam verified the game files ----------

test("a font Steam's verify replaced is noticed, and put back from the download cache", (t) => {
  const s = stand(t);
  fs.mkdirSync(path.join(s.game, ...FONTS), { recursive: true });
  fs.writeFileSync(path.join(s.game, ...FONTS, 'radiance.ttf'), 'valve font');
  const cached = path.join(s.installer.downloadsDir, 'fonts', 'Font A.zip');
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  const z = new AdmZip();
  z.addFile('Font A/assets/custom/radiance.ttf', Buffer.from('font A'));
  z.addFile('Font A/assets/custom/extra.ttf', Buffer.from('font A extra'));
  fs.writeFileSync(cached, z.toBuffer());
  const rec = { id: 'a', name: 'Font A', categoryId: 'fonts', fileRef: 'Font A.zip', enabled: true, files: install(s.installer, 'fonts', cached, 'Font A') };
  const off = { ...rec, id: 'b', enabled: false };

  assert.deepEqual(s.installer.lostToVerify([rec, off]), []);
  // what a verify does: Valve's file back, ours untouched where Valve has none
  fs.copyFileSync(path.join(s.installer.backupsDir, 'fonts', 'radiance.ttf'), path.join(s.game, ...FONTS, 'radiance.ttf'));
  assert.deepEqual(s.installer.lostToVerify([rec, off]).map((r) => r.id), ['a'], 'a switched-off mod is not missing anything');
  const back = (f: { root: string; relPath: string }) => s.installer.overlays.vanillaIsBack(f);
  assert.equal(back({ root: 'fonts', relPath: 'extra.ttf' }), false, 'a file with no original cannot be one');
  assert.equal(back({ root: 'lang', relPath: 'pak10_dir.vpk' }), false);

  assert.equal(s.installer.restoreDeployed(rec), 'cache');
  assert.equal(s.read(...FONTS, 'radiance.ttf'), 'font A');
  assert.deepEqual(s.installer.lostToVerify([rec]), []);
  /* The repair met extra.ttf still on disk, and it is the mod's own file. Keeping it as the
     game's original meant removing the mod later put it straight back. */
  assert.equal(fs.existsSync(path.join(s.installer.backupsDir, 'fonts', 'extra.ttf')), false, 'the mod was kept as an original');

  fs.rmSync(path.join(s.game, ...FONTS, 'extra.ttf'));
  assert.equal(back({ root: 'fonts', relPath: 'extra.ttf' }), true, 'a deleted file is as good as reverted');

  s.installer.remove(rec.files);
  assert.equal(s.read(...FONTS, 'radiance.ttf'), 'valve font');
  assert.deepEqual(fs.readdirSync(path.join(s.game, ...FONTS)), ['radiance.ttf'], 'removing the font left a file of its own behind');
});

test("a font that ships some of Valve's files unchanged is not taken for one a verify undid", (t) => {
  /* Nothing Font carries creepster-regular.ttf and grenze-bold.ttf in assets/custom byte for byte
     as Valve ships them. Compared with the kept originals, the mod looked undone the moment it was
     installed, and the app wrote it out again at every start. */
  const s = stand(t);
  fs.mkdirSync(path.join(s.game, ...FONTS), { recursive: true });
  fs.writeFileSync(path.join(s.game, ...FONTS, 'creepster-regular.ttf'), 'valve creepster');
  fs.writeFileSync(path.join(s.game, ...FONTS, 'radiance-light.otf'), 'valve radiance');
  const local = s.zip('Nothing Font.zip', [
    ['Nothing Font/assets/custom/creepster-regular.ttf', 'valve creepster'],
    ['Nothing Font/assets/custom/radiance-light.otf', 'nothing radiance'],
    ['Nothing Font/assets/default/creepster-regular.ttf', 'valve creepster'],
  ]);
  const rec = { id: 'nf', name: 'Nothing Font', categoryId: 'fonts', fileRef: 'Nothing Font.zip', enabled: true, files: install(s.installer, 'fonts', local, 'Nothing Font') };

  assert.deepEqual(s.installer.lostToVerify([rec]), [], 'reported as undone straight after installing');
  assert.ok(fs.existsSync(path.join(s.installer.backupsDir, 'fonts', 'creepster-regular.ttf')), "the game's copy is still kept, even though it matches");

  // a real verify still shows
  fs.writeFileSync(path.join(s.game, ...FONTS, 'radiance-light.otf'), 'valve radiance');
  assert.deepEqual(s.installer.lostToVerify([rec]).map((r) => r.id), ['nf']);

  // and removing it leaves Valve's copies where they were
  s.installer.remove(rec.files);
  assert.equal(s.read(...FONTS, 'creepster-regular.ttf'), 'valve creepster');
  assert.equal(s.read(...FONTS, 'radiance-light.otf'), 'valve radiance');
});

test('a cursor set installed before the app recorded its writes stops being reported once it is put back', (t) => {
  /* One real install logged "restored after verify" for the same cursor set 29 times in August:
     66 of its 110 files matched the kept originals. An install from before the fix has no record
     of what was written, so the first check still reports it; putting it back writes that record,
     and the next check is quiet. */
  const s = stand(t);
  fs.mkdirSync(path.join(s.game, ...CURSOR), { recursive: true });
  fs.writeFileSync(path.join(s.game, ...CURSOR, 'cursor.res'), 'valve res');
  fs.writeFileSync(path.join(s.game, ...CURSOR, 'cursor_default.bmp'), 'valve arrow');
  const local = s.zip('Purple.zip', [['Purple/cursor/cursor.res', 'valve res'], ['Purple/cursor/cursor_default.bmp', 'purple arrow']]);
  const files = install(s.installer, 'cursors', local, 'Purple');
  s.installer.ensureCursorStore('purple', files);
  const rec = { id: 'purple', name: 'Purple', categoryId: 'cursors', enabled: true, files };
  fs.rmSync(path.join(s.installer.backupsDir, 'written.json'));

  assert.deepEqual(s.installer.lostToVerify([rec]).map((r) => r.id), ['purple'], 'the old check, with nothing recorded');
  assert.equal(s.installer.restoreDeployed(rec), 'store');
  assert.deepEqual(s.installer.lostToVerify([rec]), [], 'still reported after being put back');
  assert.equal(s.read(...CURSOR, 'cursor_default.bmp'), 'purple arrow');
});

test('a cursor set comes back from its own store, and a font with no cached archive does not', (t) => {
  const s = stand(t);
  const local = s.zip('Neon.zip', [['Neon/cursor/cursor_default.bmp', 'neon']]);
  const files = install(s.installer, 'cursors', local, 'Neon');
  s.installer.ensureCursorStore('neon', files);
  fs.rmSync(path.join(s.game, ...CURSOR, 'cursor_default.bmp'));

  assert.equal(s.installer.restoreDeployed({ id: 'neon', name: 'Neon', files }), 'store');
  assert.equal(s.read(...CURSOR, 'cursor_default.bmp'), 'neon');

  const font = { id: 'f', name: 'Gone', categoryId: 'fonts', fileRef: 'Gone.zip', files: [{ root: 'fonts', relPath: 'x.ttf' }] };
  assert.equal(s.installer.restoreDeployed(font), null);
  assert.equal(s.installer.cachedArchive(null, 'Gone.zip'), null);
});

test('without a game path nothing is reported lost', (t) => {
  const s = stand(t, { game: false });
  assert.deepEqual(s.installer.lostToVerify([{ enabled: true, files: [{ root: 'fonts', relPath: 'a.ttf' }] }]), []);
  assert.equal(s.installer.fontFolderHashes(), null);
});

// ---------- what is on disk ----------

test('the font folder is fingerprinted file by file, under lower-case names', (t) => {
  const s = stand(t);
  assert.equal(s.installer.fontFolderHashes(), null, 'no font folder yet');
  fs.mkdirSync(path.join(s.game, ...FONTS, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(s.game, ...FONTS, 'Radiance.TTF'), 'abc');
  fs.writeFileSync(path.join(s.game, ...FONTS, 'sub', 'b.ttf'), '');
  assert.deepEqual(s.installer.fontFolderHashes(), {
    'radiance.ttf': 'a9993e364706816aba3e25717850c26c9cd0d89d',
    'b.ttf': 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
  });
});

test('the download cache reports its size and can be emptied', (t) => {
  const s = stand(t);
  assert.equal(s.installer.downloadCacheSize(), 0);
  fs.mkdirSync(path.join(s.installer.downloadsDir, 'heroes'), { recursive: true });
  fs.writeFileSync(path.join(s.installer.downloadsDir, 'heroes', 'Axe.zip'), Buffer.alloc(1000));
  fs.writeFileSync(path.join(s.installer.downloadsDir, 'index.json'), '{}');
  assert.equal(s.installer.downloadCacheSize(), 1002);
  assert.equal(s.installer.cachedArchive('heroes', 'Axe.zip'), path.join(s.installer.downloadsDir, 'heroes', 'Axe.zip'));

  s.installer.clearDownloadCache();
  assert.equal(s.installer.downloadCacheSize(), 0);
  assert.ok(fs.existsSync(s.installer.downloadsDir), 'the folder itself is still there to download into');
  assert.equal(s.installer.cachedArchive('heroes', 'Axe.zip'), null);
});

test('a cursor set another program put in the game is found, folders and all, unless the app manages cursors', (t) => {
  const s = stand(t);
  fs.mkdirSync(path.join(s.game, ...CURSOR, 'anim'), { recursive: true });
  fs.writeFileSync(path.join(s.game, ...CURSOR, 'cursor_default.bmp'), 'someone else');
  fs.writeFileSync(path.join(s.game, ...CURSOR, 'anim', 'spin.ani'), 'frames');

  const found = s.installer.externalFiles([]).filter((x) => x.kind === 'cursor');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].files.map((f) => f.relPath).sort(), ['anim/spin.ani', 'cursor_default.bmp']);
  assert.equal(found[0].size, 'someone else'.length + 'frames'.length);

  assert.deepEqual(s.installer.externalFiles([{ root: 'cursor', relPath: 'cursor_default.bmp' }]).filter((x) => x.kind === 'cursor'), []);
});

// ---------- the load order in two parts ----------
//
// Slots 02-29 belong to the categories that must load first, everything else starts at 30
// (PRIORITY_SLOTS in src/slot-zones.ts).


/** A pak file of ours on disk and the record that owns it. */
function placed(s: Stand, library: Library, { base, categoryId, name = base, suffix = '', volumes = 0 }: {
  base: string; categoryId: string; name?: string; suffix?: string; volumes?: number;
}) {
  fs.mkdirSync(s.lang, { recursive: true });
  fs.writeFileSync(path.join(s.lang, `${base}_dir.vpk${suffix}`), name);
  const files = [{ root: 'lang', relPath: `${base}_dir.vpk` }];
  for (let v = 0; v < volumes; v++) {
    const part = `${base}_${String(v).padStart(3, '0')}.vpk`;
    fs.writeFileSync(path.join(s.lang, part + suffix), `${name} volume ${v}`);
    files.push({ root: 'lang', relPath: part });
  }
  return library.add({ name, categoryId, fileRef: name, files });
}

const paksIn = (s: Stand) => fs.readdirSync(s.lang).filter((f) => f.startsWith('pak') || f.startsWith('mmslot')).sort();

test('the categories that load first get 02-29, the rest start at 30, and a full front spills behind', (t) => {
  const s = stand(t);
  const used = new Set<string>();
  const front = Array.from({ length: 28 }, () => s.installer.allocatePak(used, true));
  assert.equal(front[0], 'pak02_dir.vpk');
  assert.equal(front[27], 'pak29_dir.vpk');
  assert.equal(s.installer.allocatePak(used, true), 'pak30_dir.vpk', 'the 29th still installs, in the first slot after them');
  assert.equal(s.installer.allocatePak(used, false), 'pak31_dir.vpk');
  const rest = new Set<string>();
  // 30-99 is seventy slots: Minify keeps 65-67 and the app's own pak64 (src/notice-text.ts)
  for (let i = 0; i < 66; i++) {
    const n = Number(s.installer.allocatePak(rest, false).slice(3, 5));
    assert.ok(n >= 30 && n !== 64, 'the rest never take 02-29, nor pak64');
  }
  assert.throws(() => s.installer.allocatePak(rest, false), /30-99/);
});

test('linking to the catalog moves a mod into its part of the order, and leaves it when that part is full', (t) => {
  const s = stand(t);
  const library = new Library(path.join(s.dir, 'userdata'));
  // imported by hand into a slot among the rest, then found to be a shader
  const shader = placed(s, library, { base: 'pak31', categoryId: 'shaders' });
  const moved = s.installer.moveToZone(shader);
  assert.deepEqual(moved, [{ root: 'lang', relPath: 'pak02_dir.vpk' }]);
  assert.equal(s.read('dota_russian', 'pak02_dir.vpk'), 'pak31');
  // a file somebody dropped in as pak05 that turns out to be a hero
  const hero = placed(s, library, { base: 'pak05', categoryId: 'heroes' });
  assert.deepEqual(s.installer.moveToZone(hero), [{ root: 'lang', relPath: 'pak30_dir.vpk' }]);
  // already in place: nothing to do
  assert.equal(s.installer.moveToZone({ ...shader, files: moved }), null);
  // its part full: better where it is than nowhere
  for (let n = 3; n <= 29; n++) fs.writeFileSync(path.join(s.lang, `pak${String(n).padStart(2, '0')}_dir.vpk`), 'taken');
  const late = placed(s, library, { base: 'pak40', categoryId: 'trees' });
  assert.equal(s.installer.moveToZone(late), null);
});

test('an existing order is laid out in its two parts once, keeping the order within each', (t) => {
  const s = stand(t);
  const library = new Library(path.join(s.dir, 'userdata'));
  // A load order from before: a hero moved up into 02, a shader switched off at 14, trees at 03
  // with the master switch off, a hero at 10 with a volume, a file of somebody else's at 12 and
  // Minify's at 65.
  placed(s, library, { base: 'pak02', categoryId: 'heroes', name: 'hero moved up' });
  placed(s, library, { base: 'pak03', categoryId: 'trees', name: 'trees', suffix: '.moff' });
  placed(s, library, { base: 'pak10', categoryId: 'heroes', name: 'hero with a volume', volumes: 1 });
  placed(s, library, { base: 'pak14', categoryId: 'shaders', name: 'shader', suffix: '.off' });
  fs.writeFileSync(path.join(s.lang, 'pak12_dir.vpk'), 'not ours');
  fs.writeFileSync(path.join(s.lang, 'pak65_dir.vpk'), 'minify');

  assert.deepEqual(s.installer.migrateSlotZones(library), { moved: 4 });
  assert.deepEqual(paksIn(s), [
    'pak02_dir.vpk.moff', // trees, first of the front as it was first of them before
    'pak03_dir.vpk.off', // the shader, after the trees, still off
    'pak12_dir.vpk', // not ours: where it was
    'pak30_dir.vpk', // the hero that had been moved up, first of the rest
    'pak31_000.vpk', 'pak31_dir.vpk', // the other hero, with its volume
    'pak65_dir.vpk', // Minify's
  ]);
  assert.equal(s.read('dota_russian', 'pak02_dir.vpk.moff'), 'trees');
  assert.equal(s.read('dota_russian', 'pak30_dir.vpk'), 'hero moved up');
  assert.equal(s.read('dota_russian', 'pak31_000.vpk'), 'hero with a volume volume 0');
  const byName = Object.fromEntries(library.list().map((r) => [r.name, r.files.map((f) => f.relPath)]));
  assert.deepEqual(byName['hero with a volume'], ['pak31_dir.vpk', 'pak31_000.vpk'], 'the records follow the files');
  assert.deepEqual(byName.shader, ['pak03_dir.vpk']);

  assert.deepEqual(s.installer.migrateSlotZones(library), { moved: 0 }, 'a second run finds nothing to move');
});

test('a layout that fails half way puts every file back where it was', (t) => {
  const s = stand(t);
  const library = new Library(path.join(s.dir, 'userdata'));
  placed(s, library, { base: 'pak02', categoryId: 'heroes', name: 'a' });
  placed(s, library, { base: 'pak10', categoryId: 'heroes', name: 'b' });
  placed(s, library, { base: 'pak11', categoryId: 'river', name: 'c' });
  const before = paksIn(s);
  const records = JSON.stringify(library.list());
  // the game holding one file open: the rename that reaches it fails
  const real = fs.renameSync;
  let calls = 0;
  t.after(() => { fs.renameSync = real; });
  fs.renameSync = (from, to) => {
    if (++calls === 4) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return real(from, to);
  };
  assert.throws(() => s.installer.migrateSlotZones(library), /EBUSY/);
  fs.renameSync = real;
  assert.deepEqual(paksIn(s), before, 'every file is back under its old name');
  assert.equal(JSON.stringify(library.list()), records, 'and no record was changed');
});

test('a mod whose second file the game holds open stays whole under its old slot', (t) => {
  /* A pak and its volumes load only under one name. Moving one up the order while Dota runs used
     to rename the index, fail on the volume, and leave the mod split across two slots. */
  const s = stand(t);
  const library = new Library(path.join(s.dir, 'userdata'));
  const rec = placed(s, library, { base: 'pak40', categoryId: 'heroes', name: 'with a volume', volumes: 2 });
  const before = paksIn(s);
  const real = fs.renameSync;
  t.after(() => { fs.renameSync = real; });
  let calls = 0;
  fs.renameSync = (from, to) => {
    if (++calls === 2) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return real(from, to);
  };
  assert.throws(() => s.installer.moveToSlot(rec, 'pak41'), /EBUSY/);
  fs.renameSync = real;
  assert.deepEqual(paksIn(s), before, 'the index came back to join its volumes');
});

test('a swap the game refuses half way leaves both mods whole in their own slots', (t) => {
  /* A swap parks one mod on pak00, moves the other into its slot, then the first into the
     other's. Refuse the last step and the first mod has to go home, into a slot the second mod
     now fills: putting it back before moving the second out would write one mod over the other. */
  const s = stand(t);
  const library = new Library(path.join(s.dir, 'userdata'));
  const a = placed(s, library, { base: 'pak30', categoryId: 'heroes', name: 'first' });
  const b = placed(s, library, { base: 'pak31', categoryId: 'heroes', name: 'second' });
  const real = fs.renameSync;
  t.after(() => { fs.renameSync = real; });
  for (let refuse = 1; refuse <= 3; refuse++) {
    let calls = 0;
    fs.renameSync = (from, to) => {
      if (++calls === refuse) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      return real(from, to);
    };
    assert.throws(() => s.installer.swapSlots(a, b), /EBUSY/, `rename ${refuse} refused`);
    fs.renameSync = real;
    assert.deepEqual(paksIn(s), ['pak30_dir.vpk', 'pak31_dir.vpk'], `rename ${refuse} refused: both slots are back`);
    assert.equal(s.read('dota_russian', 'pak30_dir.vpk'), 'first', `rename ${refuse} refused: nothing was written over`);
    assert.equal(s.read('dota_russian', 'pak31_dir.vpk'), 'second');
  }
});

test('wherever the game refuses a rename during the layout, every file and record ends as it began', (t) => {
  /* The test above fails the fourth rename, in the second pass. A game holding a file open can
     refuse any of them, the first included and the last, so each one is refused in turn. */
  const setUp = () => {
    const s = stand(t);
    const library = new Library(path.join(s.dir, 'userdata'));
    placed(s, library, { base: 'pak02', categoryId: 'heroes', name: 'a', volumes: 1 });
    placed(s, library, { base: 'pak10', categoryId: 'heroes', name: 'b', suffix: '.off' });
    placed(s, library, { base: 'pak11', categoryId: 'river', name: 'c' });
    return { s, library };
  };
  const real = fs.renameSync;
  t.after(() => { fs.renameSync = real; });
  // how many renames a layout that succeeds makes
  const counted = (() => {
    const { s, library } = setUp();
    let n = 0;
    fs.renameSync = (from, to) => { n++; return real(from, to); };
    s.installer.migrateSlotZones(library);
    fs.renameSync = real;
    return n;
  })();
  assert.ok(counted >= 6, `a layout of three mods renames ${counted} files, so every pass is exercised`);

  for (let refuse = 1; refuse <= counted; refuse++) {
    const { s, library } = setUp();
    const before = paksIn(s);
    const records = JSON.stringify(library.list());
    let calls = 0;
    fs.renameSync = (from, to) => {
      if (++calls === refuse) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      return real(from, to);
    };
    assert.throws(() => s.installer.migrateSlotZones(library), /EBUSY/, `rename ${refuse} refused`);
    fs.renameSync = real;
    assert.deepEqual(paksIn(s), before, `rename ${refuse} refused: every file is back under its old name`);
    assert.equal(JSON.stringify(library.list()), records, `rename ${refuse} refused: no record changed`);
  }
});

test('a mod on the slot the notice text took moves to the first free one behind it, volumes and state kept', (t) => {
  const s = stand(t);
  const library = new Library(path.join(s.dir, 'userdata'));
  placed(s, library, { base: 'pak64', categoryId: 'heroes', name: 'was on 64', suffix: '.off', volumes: 1 });
  placed(s, library, { base: 'pak68', categoryId: 'heroes', name: 'behind it' });
  fs.writeFileSync(path.join(s.lang, 'pak65_dir.vpk'), 'minify');
  assert.equal(vacateAppPak(s.installer, library), true);
  assert.deepEqual(paksIn(s), ['pak65_dir.vpk', 'pak68_dir.vpk', 'pak69_000.vpk.off', 'pak69_dir.vpk.off']);
  const rec = library.list().find((r) => r.name === 'was on 64');
  assert.deepEqual(rec?.files.map((f) => f.relPath), ['pak69_dir.vpk', 'pak69_000.vpk']);
  assert.equal(vacateAppPak(s.installer, library), false, 'nothing left on 64');
});

test('a move off the notice slot that the game refuses puts the files back and changes no record', (t) => {
  const s = stand(t);
  const library = new Library(path.join(s.dir, 'userdata'));
  placed(s, library, { base: 'pak64', categoryId: 'heroes', name: 'held open', volumes: 1 });
  const before = paksIn(s);
  const records = JSON.stringify(library.list());
  const real = fs.renameSync;
  let calls = 0;
  t.after(() => { fs.renameSync = real; });
  fs.renameSync = (from, to) => {
    if (++calls === 2) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return real(from, to);
  };
  assert.throws(() => vacateAppPak(s.installer, library), /EBUSY/);
  fs.renameSync = real;
  assert.deepEqual(paksIn(s), before);
  assert.equal(JSON.stringify(library.list()), records);
});

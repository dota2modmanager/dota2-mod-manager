/* Taking in a mod the user already has: a .vpk, a .zip, a folder, or bytes off a drop.
 *
 * This is the widest door in the app and the least fussy about what comes through it. A
 * Skinchanger pack unzips to a whole game tree with the archive several folders down. A
 * Dota2Changer mod arrives as an index plus data volumes, and the rest of the app assumes one
 * file per mod, so a half-folded set is exactly how a mod ends up half-loaded. An author's
 * working folder holds no archive at all. And whatever arrives, the language folder it lands in
 * belongs to the game and to other tools too, so what the app writes there has to be its own.
 *
 * Four hundred and fifty lines of src/installer.ts carry that, and until this file one method of
 * the fourteen had a test. Written before the section is split out, so the split has something to
 * prove itself against.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

const vpk = require('../src/vpk.ts');
const { entry } = require('./helpers/vpk-entry.ts');
const { Installer } = require('../src/installer.ts');
const { importVpks, importVpkBuffers, installVpkBuffer } = require('../src/import.js');

/** A self-contained mod, the shape the catalog ships. */
const mod = (files) => vpk.buildVpk(files.map(([p, b]) => entry(p, b)));

/** A game folder the installer accepts, an installer pointed at it, and a place to drop things. */
function stand(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-import-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), 'the game\'s own archive');
  const installer = new Installer({
    userDataDir: path.join(dir, 'userdata'),
    getGamePath: () => game,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });

  /** A folder outside the game to import from, with files laid out in it. */
  const source = (name, files) => {
    const root = path.join(dir, name);
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(root, ...rel.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }
    fs.mkdirSync(root, { recursive: true });
    return root;
  };

  /** What is in the language folder now, mods only. */
  const installed = () => fs.readdirSync(lang).filter((f) => /\.vpk$/i.test(f)).sort();
  /** Inner paths of a mod sitting in the language folder. */
  const inside = (relPath) => vpk.listVpkPaths(fs.readFileSync(path.join(lang, relPath))).sort();

  return { dir, installer, lang, source, installed, inside };
}

const HOOK = 'models/items/pudge/hook/hook.vmdl_c';
const BLADE = 'models/items/juggernaut/blade/blade.vmdl_c';

test('a mod several folders down in what was dropped is still found', async (t) => {
  // a Skinchanger pack unzips to a whole game tree; the archive is never at the top
  const { installer, source, installed, inside } = stand(t);
  const dropped = source('pack', { 'pack/game/Dota2SkinChanger/hook_dir.vpk': mod([[HOOK, 'the hook']]) });

  const [result] = await importVpks(installer,[dropped]);

  assert.equal(result.error, undefined, result.error);
  assert.equal(result.files.length, 1);
  assert.deepEqual(installed(), [result.files[0].relPath]);
  assert.deepEqual(inside(result.files[0].relPath), [HOOK]);
});

test('an author\'s folder with no archive in it is packed on the way in', async (t) => {
  /* Authors work in loose files and had nothing to point the app at. The folder goes through the
     same door as a .vpk: a slot of ours, the same naming, the same transaction. */
  const { installer, source, inside } = stand(t);
  const working = source('my mod', {
    'models/items/pudge/hook/hook.vmdl_c': 'the hook model',
    'materials/models/items/pudge/hook/hook_color_png_1.vtex_c': 'the texture',
  });

  const [result] = await importVpks(installer,[working]);

  assert.equal(result.error, undefined, result.error);
  assert.deepEqual(inside(result.files[0].relPath), [
    'materials/models/items/pudge/hook/hook_color_png_1.vtex_c', HOOK,
  ].sort());
});

test('a folder holding nothing the game reads is refused by name', async (t) => {
  const { installer, source, installed } = stand(t);
  const notAMod = source('holiday photos', { 'notes.txt': 'buy milk', 'cat.png': 'meow' });

  const [result] = await importVpks(installer,[notAMod]);

  assert.match(result.error, /\.vpk/);
  assert.equal(result.source, 'holiday photos');
  assert.deepEqual(installed(), [], 'something was installed from a folder that holds no mod');
});

test('a zip gives up its mods and nothing else', async (t) => {
  const { installer, source, installed, inside } = stand(t);
  const zip = new AdmZip();
  zip.addFile('hook_dir.vpk', mod([[HOOK, 'the hook']]));
  zip.addFile('readme.txt', Buffer.from('install by hand'));
  const dir = source('zips', {});
  const file = path.join(dir, 'pack.zip');
  fs.writeFileSync(file, zip.toBuffer());

  const [result] = await importVpks(installer,[file]);

  assert.equal(result.error, undefined, result.error);
  assert.equal(installed().length, 1, 'the archive gave up more than its mod');
  assert.deepEqual(inside(result.files[0].relPath), [HOOK]);
});

test('a zip with no mod in it says so instead of quietly importing nothing', async (t) => {
  const { installer, source, installed } = stand(t);
  const zip = new AdmZip();
  zip.addFile('readme.txt', Buffer.from('how to install by hand'));
  const dir = source('zips', {});
  const file = path.join(dir, 'guide.zip');
  fs.writeFileSync(file, zip.toBuffer());

  const [result] = await importVpks(installer,[file]);

  assert.match(result.error, /\.vpk/);
  assert.deepEqual(installed(), []);
});

test('an index and its data volumes are folded into one file', async (t) => {
  /* The rest of the app keys off a single name: enable, disable, export, packing and the folder
     sync all assume one file per mod, and a stray half-set left behind is how a mod ends up
     half-loaded. This is the case Skinchanger and Dota2Changer packs actually arrive in. */
  const { installer, source, installed, inside } = stand(t);
  const from = source('set', {});
  vpk.combineVpksToFiles([{ key: 'a', buf: mod([[HOOK, 'the hook'], [BLADE, 'the blade']]) }], from, 'pak01');

  const [result] = await importVpks(installer,[from]);

  assert.equal(result.error, undefined, result.error);
  assert.equal(result.merged, 2, 'the index and its one volume were not folded together');
  assert.equal(result.files.length, 1, 'a mod that arrived as a set is still a set in the folder');
  assert.deepEqual(installed(), [result.files[0].relPath]);
  assert.deepEqual(inside(result.files[0].relPath), [BLADE, HOOK].sort());
});

test('data volumes with no index beside them are refused, not half-installed', async (t) => {
  /* Half a mod in the language folder is worse than none: the game mounts what it finds. */
  const { installer, source, installed } = stand(t);
  const from = source('orphans', {});
  fs.writeFileSync(path.join(from, 'skin_000.vpk'), 'data with no index');

  const results = await importVpks(installer,[from]);

  assert.equal(results.length, 1);
  assert.match(results[0].error, /_dir\.vpk/);
  assert.deepEqual(installed(), []);
});

test('one thing that is not a mod does not take the rest of the batch with it', async (t) => {
  /* Importing is a batch: dropping twenty files and losing all of them because one was a readme
     is the behaviour this rules out. Each mod is its own transaction. */
  const { installer, source, installed } = stand(t);
  const from = source('mixed', {});
  const good = path.join(from, 'hook_dir.vpk');
  fs.writeFileSync(good, mod([[HOOK, 'the hook']]));
  const bad = path.join(from, 'readme.txt');
  fs.writeFileSync(bad, 'not a mod');

  const results = await importVpks(installer,[bad, good]);

  assert.equal(results.filter((r) => r.error).length, 1, 'the readme was taken for a mod');
  assert.equal(results.filter((r) => !r.error).length, 1, 'the mod was lost with the readme');
  assert.equal(installed().length, 1);
});

test('an import takes a free slot, never one that is occupied', async (t) => {
  const { installer, lang, source, installed } = stand(t);
  fs.writeFileSync(path.join(lang, 'pak10_dir.vpk'), mod([[BLADE, 'somebody else\'s mod']]));
  const from = source('mine', {});
  fs.writeFileSync(path.join(from, 'hook_dir.vpk'), mod([[HOOK, 'the hook']]));

  const [result] = await importVpks(installer,[path.join(from, 'hook_dir.vpk')]);

  assert.notEqual(result.files[0].relPath, 'pak10_dir.vpk', 'the import replaced a mod already there');
  assert.equal(installed().length, 2);
});

test('bytes that are not a VPK never reach the game folder', (t) => {
  /* installVpkBuffer takes what a stranger put in a shared preset. The index is parsed before
     anything is written, and the slot name is ours rather than theirs. */
  const { installer, installed } = stand(t);

  assert.throws(() => installVpkBuffer(installer,Buffer.from('not an archive at all')));
  assert.deepEqual(installed(), [], 'something was written before the bytes were understood');

  const files = installVpkBuffer(installer,mod([[HOOK, 'the hook']]));
  assert.match(files[0].relPath, /^pak\d+_dir\.vpk$/);
  assert.deepEqual(installed(), [files[0].relPath]);
});

test('the folder says which files are ours, and stops saying it once they are gone', (t) => {
  /* Another mod manager reads this note before it deletes anything, so a stale claim on a file
     we no longer have is a claim on somebody else's file. It is rewritten, not appended to.
     The note keeps whatever spelling a name had when it was written and Windows hands back the
     other one, so both sides of the comparison have to be folded: written in capitals here on
     purpose, because a lookup that only folded the question still passed the first version of
     this test. */
  const { installer, lang } = stand(t);

  installer.writeOwnership(['Pak10_Dir.vpk', 'pak11_dir.vpk']);
  assert.equal(installer.ownsFile('pak10_dir.vpk'), true, 'a name stored with capitals is still ours');
  assert.equal(installer.ownsFile('PAK11_DIR.VPK'), true, 'and so is one asked about with capitals');
  assert.equal(installer.ownsFile('pak12_dir.vpk'), false);

  installer.writeOwnership(['pak11_dir.vpk']);
  assert.equal(installer.ownsFile('pak10_dir.vpk'), false, 'the note still claims a file that is gone');
  assert.ok(fs.existsSync(path.join(lang, 'dota2modmanager.json')));
});

test('a note nobody can write does not fail the install it was describing', (t) => {
  const { installer, lang } = stand(t);
  fs.rmSync(lang, { recursive: true, force: true });

  assert.doesNotThrow(() => installer.writeOwnership(['pak10_dir.vpk']));
  assert.equal(installer.ownsFile('pak10_dir.vpk'), false);
});

test('the game\'s own tables are stripped out of an import, and a mod\'s own edit is kept', (t) => {
  /* Packing tools bake the whole 47 MB items_game.txt and a full localization copy into every
     export. The localization copy is the harmful one: it outranks the game's own and rolls UI
     text back to whenever the pack was built. A small localization file is a deliberate edit,
     such as a mod renaming an item, and that survives. */
  const { installer, lang, inside } = stand(t);
  const big = Buffer.alloc(300 * 1024, 'x');
  fs.writeFileSync(path.join(lang, 'pak10_dir.vpk'), mod([
    [HOOK, 'the hook'],
    ['scripts/items/items_game.txt', '"items_game" { }'],
    ['resource/localization/dota_russian.txt', big],
    ['resource/localization/mymod.txt', 'one renamed item'],
  ]));
  const records = [{ root: 'lang', relPath: 'pak10_dir.vpk' }];

  const { stripped } = installer.harvestSchema(records, '"items_game" { }');

  assert.deepEqual(stripped, ['pak10_dir.vpk']);
  const left = inside('pak10_dir.vpk');
  assert.ok(!left.includes('scripts/items/items_game.txt'), 'the whole item table is still in there');
  assert.ok(!left.includes('resource/localization/dota_russian.txt'), 'the stale localization copy survived');
  assert.ok(left.includes('resource/localization/mymod.txt'), 'the mod\'s own text edit was thrown away');
  assert.ok(left.includes(HOOK));
});

test('bytes dropped on the window go in through the same door as files', async (t) => {
  /* A drop cannot always resolve to a path on disk, so the bytes are staged and handed to the
     same importer. What it must not do is leave the staging folder behind. */
  const { dir, installer, installed, inside } = stand(t);
  const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('mm-import-')).length;

  const results = await importVpkBuffers(installer,[
    { name: 'hook_dir.vpk', data: mod([[HOOK, 'the hook']]) },
    { name: 'notes.txt', data: Buffer.from('ignored, not an archive') },
  ]);

  assert.equal(results.length, 1, 'something other than a mod was taken in');
  assert.deepEqual(inside(results[0].files[0].relPath), [HOOK]);
  assert.equal(installed().length, 1);
  assert.equal(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('mm-import-')).length, before,
    'the staging folder was left in the temp directory');
  assert.ok(fs.existsSync(dir));
});

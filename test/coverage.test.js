// Which mod actually supplies a file two mods both carry.
//
// The game mounts pakNN_dir.vpk in numeric order and the first copy of a file wins, so the
// lower pak number is the one that counts. A mod that lost is installed, switched on, and
// doing nothing - which used to look like the app breaking it. Measured over 84 installed
// mods: 801 paths are carried by more than one mod, and only 84 of those hold different
// bytes, so a shared path on its own proves nothing and the CRC has to decide.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crc32 } = require('node:zlib');

const vpk = require('../src/vpk.ts');
const { entry } = require('./helpers/vpk-entry.ts');
const { Installer } = require('../src/installer.js');

/** A game folder with a language folder, and an installer pointed at it. */
function stand(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-cov-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  const installer = new Installer({
    userDataDir: path.join(dir, 'userdata'),
    getGamePath: () => game,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });
  const put = (slot, files) => {
    fs.writeFileSync(path.join(lang, `${slot}_dir.vpk`), vpk.buildVpk(files.map(([p, b]) => entry(p, b))));
    return { key: slot, name: slot, files: [{ root: 'lang', relPath: `${slot}_dir.vpk` }] };
  };
  return { installer, put };
}

const MODEL = 'models/items/pudge/hook/hook.vmdl_c';

test('the lower pak number supplies the file, and the other one is told', (t) => {
  const { installer, put } = stand(t);
  const top = put('pak10', [[MODEL, 'the hook you see']]);
  const under = put('pak20', [[MODEL, 'a different hook']]);

  const covered = installer.coverage([top, under]);
  assert.equal(covered.has('pak10'), false, 'the winner is not covered by anybody');
  assert.deepEqual(covered.get('pak20'), [{ name: 'pak10', files: 1 }]);
});

test('two copies of one mod are the case worth reporting, not one to hide', (t) => {
  // an older and a newer build of the same skin sit in two slots under one name; keying the
  // answer by name would have called this a mod covering itself and said nothing
  const { installer, put } = stand(t);
  const older = { ...put('pak30', [[MODEL, 'last season\'s hook']]), key: 'a', name: 'Pudge Hook' };
  const newer = { ...put('pak10', [[MODEL, 'this season\'s hook']]), key: 'b', name: 'Pudge Hook' };

  const covered = installer.coverage([older, newer]);
  assert.deepEqual(covered.get('a'), [{ name: 'Pudge Hook', files: 1 }]);
  assert.equal(covered.has('b'), false);
});

test('the same bytes in both mods is not a fight', (t) => {
  // filler both authors happened to ship: whichever the game picks, the file is identical
  const { installer, put } = stand(t);
  const a = put('pak10', [['materials/default/default_color_tga_1.vtex_c', 'stock filler']]);
  const b = put('pak20', [['materials/default/default_color_tga_1.vtex_c', 'stock filler']]);
  assert.equal(installer.coverage([a, b]).size, 0);
});

test('engine stock every packing tool ships is not a fight worth reporting', (t) => {
  // Cubemaps, the basic particle set, the error placeholder: tools compile them to slightly
  // different bytes, so they look contested and are not. Measured over 84 installed mods -
  // every contested path shared by more than four mods is one of these, and reporting them
  // turned 4 real overlaps into 27 warnings.
  const { installer, put } = stand(t);
  const a = put('pak10', [
    ['materials/models/cubemaps/glossy_cube_tga_4cca90d9.vtex_c', 'built by one tool'],
    ['materials/particle/basic_smoke.vtex_c', 'built by one tool'],
    ['particles/basic_explosion/basic_explosion.vpcf_c', 'built by one tool'],
    ['particles/error/error.vpcf_c', 'built by one tool'],
    ['materials/transparent/trans.vmat_c', 'built by one tool'],
    // the same stock, wrapped in a folder of the author's own
    ['mymods/materials/default/default_color_tga_1.vtex_c', 'built by one tool'],
  ]);
  const b = put('pak20', [
    ['materials/models/cubemaps/glossy_cube_tga_4cca90d9.vtex_c', 'built by another'],
    ['materials/particle/basic_smoke.vtex_c', 'built by another'],
    ['particles/basic_explosion/basic_explosion.vpcf_c', 'built by another'],
    ['particles/error/error.vpcf_c', 'built by another'],
    ['materials/transparent/trans.vmat_c', 'built by another'],
    ['mymods/materials/default/default_color_tga_1.vtex_c', 'built by another'],
  ]);
  assert.equal(installer.coverage([a, b]).size, 0);
});

test('a hero model many mods happen to replace is still a real fight', (t) => {
  // the stock rule must not become "popular files do not count": five Pudge skins replacing
  // one model is exactly the pile-up the user needs told about
  const { installer, put } = stand(t);
  const mods = ['pak10', 'pak20', 'pak30', 'pak40', 'pak50']
    .map((slot) => put(slot, [['models/heroes/pudge/pudge.vmdl_c', `pudge by ${slot}`]]));
  const covered = installer.coverage(mods);
  assert.equal(covered.size, 4, 'four of the five are overruled');
  assert.deepEqual(covered.get('pak50'), [{ name: 'pak10', files: 1 }]);
});

test('mods that share nothing are left alone', (t) => {
  const { installer, put } = stand(t);
  const a = put('pak10', [['models/items/pudge/hook/hook.vmdl_c', 'hook']]);
  const b = put('pak20', [['models/items/lina/hair/hair.vmdl_c', 'hair']]);
  assert.equal(installer.coverage([a, b]).size, 0);
});

test('a mod covered by two others names both, worst first', (t) => {
  const { installer, put } = stand(t);
  const first = put('pak05', [['a/one.vmdl_c', 'A1'], ['a/two.vmdl_c', 'A2']]);
  const second = put('pak06', [['b/three.vmdl_c', 'B3']]);
  const loser = put('pak30', [['a/one.vmdl_c', 'X1'], ['a/two.vmdl_c', 'X2'], ['b/three.vmdl_c', 'X3']]);

  const covered = installer.coverage([first, second, loser]);
  assert.deepEqual(covered.get('pak30'), [{ name: 'pak05', files: 2 }, { name: 'pak06', files: 1 }]);
  assert.equal(covered.has('pak05'), false);
});

test('a mod nobody can read is skipped rather than blamed', (t) => {
  const { installer, put } = stand(t);
  const good = put('pak10', [[MODEL, 'the hook you see']]);
  fs.writeFileSync(path.join(installer.langFolder(), 'pak20_dir.vpk'), 'not a vpk at all');
  const broken = { key: 'pak20', name: 'pak20', files: [{ root: 'lang', relPath: 'pak20_dir.vpk' }] };
  const gone = { key: 'pak40', name: 'pak40', files: [{ root: 'lang', relPath: 'pak40_dir.vpk' }] };
  assert.equal(installer.coverage([good, broken, gone]).size, 0);
});

test('a mod that lives outside a numbered pak has no place in the order', (t) => {
  // terrains, cursors and fonts are not mounted by pak number, so they cannot cover anything
  const { installer, put } = stand(t);
  const numbered = put('pak10', [[MODEL, 'the hook you see']]);
  const terrain = { key: 'terrain', name: 'terrain', files: [{ root: 'lang', relPath: 'maps/dota.vpk' }] };
  assert.equal(installer.coverage([numbered, terrain]).size, 0);
});

test('the pak slots Minify writes are never handed to one of our mods', () => {
  // Minify compiles into 65, 66 and 67 of whatever language folder it is set to. If that is
  // the folder we use as well, the two apps coexist happily right up until we name a file it
  // is about to write - and then one mod silently replaces the other, with nothing on screen
  // to say why. Ninety slots minus three is a price worth not thinking about again.
  const installer = new Installer({
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-slots-')),
    getGamePath: () => null,
    getLangSuffix: () => 'russian',
  });
  const used = new Set();
  const handed = [];
  // 30-98, less Minify's three and the app's own pak64 (src/notice-text.js)
  for (let i = 0; i < 65; i++) handed.push(installer.allocatePak(used, false));
  for (const n of [65, 66, 67, 99]) {
    assert.equal(handed.includes(`pak${n}_dir.vpk`), false, `pak${n} belongs to Minify`);
  }
  assert.equal(handed.includes('pak64_dir.vpk'), false, 'pak64 is the app\'s own');
  // and everything either side of them is still offered, so nothing else was lost
  for (const n of [63, 68, 30, 98]) {
    assert.equal(handed.includes(`pak${n}_dir.vpk`), true, `pak${n} should still be available`);
  }
});

test('the master switch and the foreign scan leave Minify alone', () => {
  /* Both apps in one language folder is the arrangement this project recommends, so the two
   * places that walk that folder rather than asking the library have to know whose files are
   * whose. Without this, "mods off" renames another program's work out from under it, and its
   * output shows up in My mods with buttons to adopt, disable and delete it. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-share-'));
  const lang = path.join(root, 'game', 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  const files = ['pak01_dir.vpk', 'gameinfo.gi', 'pak10_dir.vpk',
    'pak65_dir.vpk', 'pak66_dir.vpk', 'pak66_000.vpk', 'pak67_dir.vpk'];
  for (const f of files) fs.writeFileSync(path.join(lang, f), 'x');

  const installer = new Installer({
    userDataDir: root,
    getGamePath: () => path.join(root, 'game'),
    getLangSuffix: () => 'russian',
  });

  installer.setMasterEnabled(false);
  const after = fs.readdirSync(lang).sort();
  assert.ok(after.includes('pak10_dir.vpk.moff'), 'our own mod is what the switch turns off');
  for (const f of ['pak65_dir.vpk', 'pak66_dir.vpk', 'pak66_000.vpk', 'pak67_dir.vpk']) {
    assert.ok(after.includes(f), `${f} belongs to Minify and must not be renamed`);
  }
  assert.ok(after.includes('pak01_dir.vpk') && after.includes('gameinfo.gi'), 'the game keeps its own');

  const foreign = installer.externalFiles([{ root: 'lang', relPath: 'pak10_dir.vpk' }], { scanExtras: false });
  assert.deepEqual(foreign.map((f) => f.relPath), [], 'nothing of Minify is offered as a loose file');
  fs.rmSync(root, { recursive: true, force: true });
});

test('reordering never drops a mod into a slot Minify writes', () => {
  const installer = new Installer({
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-below-')),
    getGamePath: () => null,
    getLangSuffix: () => 'russian',
  });
  // everything below 70 taken except the three that are Minify's, on a machine where it is
  // installed but has not patched yet - so the folder cannot tell us they are spoken for
  const used = new Set();
  for (let i = 2; i < 70; i++) {
    if ([65, 66, 67, 99].includes(i)) continue;
    used.add(`pak${String(i).padStart(2, '0')}_dir.vpk`);
  }
  assert.equal(installer.freeSlotBelow(70, used), null, 'no free slot beats taking one of theirs');
});

test('a map mod Minify built is left alone; a hand-installed terrain is not', () => {
  /* maps/dota.vpk is the one path with no slot to reserve: a terrain and a Minify map mod are
   * the same file name. The only thing that can tell them apart is the marker Minify packs
   * into everything it builds, and reading that convention needs no agreement from anybody.
   *
   * A terrain somebody installed by hand carries no marker at all, and it has to stay listed -
   * the whole point of the foreign-file scan is that the user can see and remove it. Absence
   * of a marker means unknown, never "not ours to touch". */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-maps-'));
  const maps = path.join(root, 'game', 'dota_russian', 'maps');
  fs.mkdirSync(maps, { recursive: true });

  const entry = (p, body) => {
    const data = Buffer.from(body);
    const norm = p.toLowerCase();
    const slash = norm.lastIndexOf('/');
    const file = slash === -1 ? norm : norm.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    return {
      ext: dot === -1 ? ' ' : file.slice(dot + 1),
      folder: slash === -1 ? ' ' : norm.slice(0, slash),
      name: dot === -1 ? file : file.slice(0, dot),
      data,
      preload: Buffer.alloc(0),
      crc: crc32(data) >>> 0,
    };
  };

  fs.writeFileSync(path.join(maps, 'dota.vpk'), vpk.buildVpk([
    entry('minify_version.txt', '1.14'), entry('maps/dota.vmap_c', 'theirs'),
  ]));
  fs.writeFileSync(path.join(maps, 'other.vpk'), vpk.buildVpk([entry('maps/dota.vmap_c', 'somebody else')]));

  const installer = new Installer({
    userDataDir: root,
    getGamePath: () => path.join(root, 'game'),
    getLangSuffix: () => 'russian',
  });
  const foreign = installer.externalFiles([], { scanExtras: true }).map((f) => f.key);
  assert.equal(foreign.includes('maps/dota.vpk'), false, 'Minify built this one');
  assert.equal(foreign.includes('maps/other.vpk'), true, 'no marker means unknown, not untouchable');
  fs.rmSync(root, { recursive: true, force: true });
});

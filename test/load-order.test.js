/* The load order in two parts, through the channels the window calls (src/ipc-library.js,
 * src/ipc-mods.js): moving a mod up or down, dragging it to a place, linking an import to the
 * catalog, and the list the screen draws. The rules themselves are src/slot-zones.ts and are
 * tested in installer.test.js; this is whether the buttons keep to them.
 *
 * The rule: shaders, trees, river, hero effects and a few more load
 * before everything else, in slots 02-29, and nothing a user does puts another mod among them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { Installer } = require('../src/installer.ts');
const { Library } = require('../src/library.ts');

const ROOT = path.resolve(__dirname, '..');

/** Register one src/ipc-*.js file against a stand-in for Electron, and hand back its channels. */
function register(file, fn, ctx) {
  const channels = new Map();
  const electron = { ipcMain: { handle: (ch, h) => channels.set(ch, h), on: (ch, h) => channels.set(ch, h) }, dialog: {}, shell: {}, app: {} };
  const load = Module._load;
  Module._load = function stubbed(request, ...rest) {
    return request === 'electron' ? electron : load.call(this, request, ...rest);
  };
  const abs = path.join(ROOT, 'src', file);
  try {
    delete require.cache[require.resolve(abs)];
    require(abs)[fn](ctx);
  } finally {
    Module._load = load;
    delete require.cache[require.resolve(abs)];
  }
  return channels;
}

/** A game folder with an installer and a library over it, and the two sets of channels. */
function stand(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-order-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  const matches = new Map(); // what the catalog would recognise a file as, by its fingerprint
  const fingerprints = { hasData: () => false, match: (fp) => matches.get(fp) || null, fonts: [] };
  const noop = () => {};
  const lib = register('ipc-library.js', 'registerLibraryIpc', {
    applyMasterToCursors: noop, catalog: {}, disableOtherCosmetics: () => [], disableOtherCursors: () => [],
    fingerprints, installer, isCursorRecord: () => false, library, refreshPresence: noop,
    schemaService: { harvest: () => null, refresh: noop, state: () => ({ enabled: false }) },
  });
  const mods = register('ipc-mods.js', 'registerModsIpc', {
    applyMasterToCursors: noop, blocked: () => null, catalog: {}, diag: noop, disableOtherCursors: () => [], fingerprints,
    importVpkBuffers: noop, importVpkPaths: noop, installer, isCursorRecord: () => false, library, refreshPresence: noop,
    schemaService: { state: () => ({ enabled: false }) }, sendProgress: noop, verifyStuck: () => false, win: () => null,
  });
  /** A pak of ours on disk and the record that owns it. */
  const put = (base, categoryId, name = `${categoryId} ${base}`) => {
    fs.writeFileSync(path.join(lang, `${base}_dir.vpk`), name);
    return library.add({ name, categoryId, fileRef: name, files: [{ root: 'lang', relPath: `${base}_dir.vpk` }] });
  };
  const slotOf = (id) => library.find(id).files[0].relPath.slice(0, 5);
  const call = (channels, ch, ...args) => channels.get(ch)({}, ...args);
  return { lang, installer, library, matches, lib, mods, put, slotOf, call };
}

test('"load earlier" stops at the first mod after the ones that load first, instead of taking a shader\'s slot', async (t) => {
  const s = stand(t);
  const shader = s.put('pak02', 'shaders');
  const trees = s.put('pak03', 'trees');
  const hero = s.put('pak30', 'heroes');
  const other = s.put('pak31', 'heroes');

  assert.deepEqual(await s.call(s.lib, 'mods:move', hero.id, -1), { ok: true, moved: 0 }, 'the top of its part');
  assert.equal(s.slotOf(hero.id), 'pak30');
  assert.equal(s.slotOf(shader.id), 'pak02');

  assert.equal((await s.call(s.lib, 'mods:move', other.id, -1)).moved, 1, 'within its part it moves as before');
  assert.equal(s.slotOf(other.id), 'pak30');
  assert.equal(s.slotOf(hero.id), 'pak31');

  assert.deepEqual(await s.call(s.lib, 'mods:move', trees.id, 1), { ok: true, moved: 0 }, 'and the last of the first part does not drop among the rest');
  assert.equal((await s.call(s.lib, 'mods:move', trees.id, -1)).moved, 1);
  assert.equal(s.slotOf(trees.id), 'pak02');
});

test('dragging a mod past the boundary takes it as far as its own part goes', async (t) => {
  const s = stand(t);
  const shader = s.put('pak02', 'shaders');
  const river = s.put('pak03', 'river');
  const a = s.put('pak30', 'heroes');
  const b = s.put('pak31', 'heroes');
  // the whole list as the screen shows it: shader, river, a, b. b dropped at the very top:
  await s.call(s.lib, 'mods:reorder', b.id, 0);
  assert.deepEqual([shader, river, b, a].map((r) => s.slotOf(r.id)), ['pak02', 'pak03', 'pak30', 'pak31']);
  // the shader dropped at the very bottom
  await s.call(s.lib, 'mods:reorder', shader.id, 3);
  assert.deepEqual([river, shader].map((r) => s.slotOf(r.id)), ['pak02', 'pak03']);
  assert.equal(s.slotOf(a.id), 'pak31', 'the rest did not move');
});

test('linking an import to the catalog moves a shader into the first part, and a hero out of it', async (t) => {
  const s = stand(t);
  const imported = s.put('pak30', 'imported', 'download (1)');
  s.installer.analyzeRecord = (rec) => ({ fp: rec.name });
  s.matches.set('download (1)', [{ name: 'Aghanim Labyrinth', categoryId: 'shaders' }]);
  const r = await s.call(s.lib, 'mods:adoptMod', imported.id, null);
  assert.deepEqual(r, { ok: true, name: 'Aghanim Labyrinth' });
  assert.equal(s.slotOf(imported.id), 'pak02');
  assert.ok(fs.existsSync(path.join(s.lang, 'pak02_dir.vpk')));
  assert.ok(!fs.existsSync(path.join(s.lang, 'pak30_dir.vpk')));

  // a file somebody dropped into the folder as pak05, taken in: not one of the first categories
  fs.writeFileSync(path.join(s.lang, 'pak05_dir.vpk'), 'not a vpk the catalog knows');
  const taken = await s.call(s.lib, 'mods:adoptExternal', 'pak05_dir.vpk', null);
  assert.equal(taken.ok, true);
  const rec = s.library.list().find((x) => x.fileRef === 'pak05_dir.vpk');
  assert.equal(s.slotOf(rec.id), 'pak30', 'into the rest, where an unknown file belongs');
});

test('the list the screen draws says which part of the order each mod is in', async (t) => {
  const s = stand(t);
  s.put('pak02', 'shaders');
  s.put('pak30', 'heroes');
  const res = await s.call(s.mods, 'mods:list');
  const zones = Object.fromEntries(res.installed.map((r) => [r.categoryId, r.zone]));
  assert.deepEqual(zones, { shaders: 'priority', heroes: 'normal' });
});

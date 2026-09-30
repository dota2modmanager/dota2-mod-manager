// Packing an author's folder into a mod, and unpacking a mod back into one.
//
// Importing used to mean "point at a .vpk". An author has the other thing - a tree of loose
// files - and the app had nothing to do with it. The hard part is not the writing but
// deciding where the archive's root is: get that wrong and the mod installs, mounts, and
// changes nothing, because every path inside it is off by a folder.
//
// The round trip is what proves it: every one of the 84 mods installed on the development
// machine unpacks to a folder and packs back with identical paths and bytes (the three that
// differ each lose one thumbs.db, which is Windows junk an author shipped by accident).
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as vpk from '../src/vpk.ts';
import installerJs from '../src/installer.js';
const { Installer } = installerJs;

/** Where the content starts under `dir`, failing the test when nothing game-shaped is there. */
function rootOf(dir: string): string {
  const root = vpk.findContentRoot(dir);
  assert.ok(root, `no content root under ${dir}`);
  return root;
}

function tmpDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-pack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Lay a tree of files out on disk: { 'models/a.vmdl_c': 'bytes', ... } */
function tree(root: string, files: Record<string, string | Buffer>) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

const MOD = {
  'models/items/pudge/hook/hook.vmdl_c': 'the hook model',
  'materials/models/items/pudge/hook/hook_color_png_1.vtex_c': 'the hook texture',
  'particles/units/heroes/hero_pudge/pudge_rot.vpcf_c': 'the effect',
};

test('a folder of game files becomes a mod with the same files in it', (t) => {
  const dir = tree(tmpDir(t), MOD);
  const buf = vpk.packFolder(rootOf(dir));

  const back = new Map(vpk.readVpkEntries(buf, 'mem').map((e) => [vpk.entryPath(e), e.data.toString()]));
  assert.deepEqual([...back.keys()].sort(), Object.keys(MOD).sort());
  for (const [rel, body] of Object.entries(MOD)) assert.equal(back.get(rel), body);
});

test('the root is the folder holding the game\'s own folders, however deep it sits', (t) => {
  // an export shaped like the game, which is what unzipping a Skinchanger pack leaves
  const deep = tree(tmpDir(t), { 'MyMod/game/dota_russian/models/x.vmdl_c': 'model' });
  assert.equal(
    vpk.findContentRoot(deep),
    path.join(deep, 'MyMod', 'game', 'dota_russian'),
  );
  // and the plain case: the author points straight at their working folder
  const flat = tree(tmpDir(t), { 'models/x.vmdl_c': 'model' });
  assert.equal(vpk.findContentRoot(flat), flat);
});

test('folders of the author\'s own travel with the game ones', (t) => {
  // measured over 84 installed mods: 35 carry a top folder of their own next to the
  // canonical ones, and three ship a readme. None of that may be dropped.
  const dir = tree(tmpDir(t), {
    'models/items/pudge/hook/hook.vmdl_c': 'model',
    'dota2pornfx/materials/skin/skin_color_png_1.vtex_c': 'the author\'s own root',
    'readme.txt': 'how to install',
  });
  const paths = vpk.listVpkPaths(vpk.packFolder(rootOf(dir)));
  assert.ok(paths.includes('dota2pornfx/materials/skin/skin_color_png_1.vtex_c'));
  assert.ok(paths.includes('readme.txt'));
});

test('a folder with nothing game-shaped in it is not a mod', (t) => {
  const dir = tree(tmpDir(t), { 'notes/todo.txt': 'buy milk', 'pictures/cat.png': 'meow' });
  assert.equal(vpk.findContentRoot(dir), null);
  assert.equal(vpk.findContentRoot(path.join(dir, 'nowhere')), null);
});

test('what Windows leaves behind does not become part of the mod', (t) => {
  // three real mods ship a thumbs.db their author never meant to include
  const dir = tree(tmpDir(t), {
    'models/x.vmdl_c': 'model',
    'panorama/images/spellicons/Thumbs.db': 'image cache',
    'materials/.DS_Store': 'finder junk',
    'desktop.ini': 'folder settings',
  });
  const paths = vpk.listVpkPaths(vpk.packFolder(rootOf(dir)));
  assert.deepEqual(paths, ['models/x.vmdl_c']);
});

test('paths go in lower case, the way the game looks them up', (t) => {
  const dir = tree(tmpDir(t), { 'Models/Items/Pudge/Hook.VMDL_C': 'model' });
  const paths = vpk.listVpkPaths(vpk.packFolder(rootOf(dir)));
  assert.deepEqual(paths, ['models/items/pudge/hook.vmdl_c']);
});

test('an empty folder is refused rather than packed into an empty mod', (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
  assert.throws(() => vpk.packFolder(dir), /файлов|files/i);
});

test('a mod unpacks to a folder that packs back into the same mod', (t) => {
  // the author's whole loop: take a mod apart, change something, drop the folder back in
  const dir = tmpDir(t);
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  const installer = new Installer({
    userDataDir: path.join(dir, 'userdata'),
    getGamePath: () => game,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });

  const source = tree(path.join(dir, 'source'), MOD);
  fs.writeFileSync(path.join(lang, 'pak10_dir.vpk'), vpk.packFolder(rootOf(source)));

  const dest = path.join(dir, 'unpacked');
  const out = installer.unpackToFolder(
    { name: 'Hook', files: [{ root: 'lang', relPath: 'pak10_dir.vpk' }] },
    dest,
  );
  assert.equal(out.files, 3);
  assert.equal(fs.readFileSync(path.join(dest, 'models/items/pudge/hook/hook.vmdl_c'), 'utf-8'), 'the hook model');

  const again = vpk.listVpkPaths(vpk.packFolder(rootOf(dest)));
  assert.deepEqual(again.sort(), Object.keys(MOD).sort());
});

test('a mod with no _dir.vpk says so instead of writing an empty folder', (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(path.join(dir, 'game', 'dota_russian'), { recursive: true });
  const installer = new Installer({
    userDataDir: path.join(dir, 'userdata'),
    getGamePath: () => path.join(dir, 'game'),
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });
  assert.throws(
    () => installer.unpackToFolder({ name: 'Cursor', files: [{ root: 'cursor', relPath: 'arrow.ani' }] }, dir),
    /_dir\.vpk/,
  );
});

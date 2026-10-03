// A picture taken out of a mod that shipped without one.
//
// Two decisions carry this feature and both are pinned here: which file inside the archive is
// the one to show, and whether what came out of it is worth showing at all. The decoding
// itself is not tested here - it is somebody else's fifty-megabyte program - but it is proven
// against 96 real mods in the ticket. What is tested is that nothing happens without that
// program, that a cached picture survives the mod moving to another pak slot, and that a mod
// whose only texture is empty is not decoded again on every scroll.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { crc32 } from 'node:zlib';

import * as vpk from '../src/vpk.ts';
import { entry } from './helpers/vpk-entry.ts';
import { createModPreviews, pickCandidate, worthShowing, type Images } from '../src/mod-preview.ts';

function userDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-mp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const noTool = { pathOf: () => null };
const withTool = (exe: string) => ({ pathOf: () => exe });

/** For the tests where nothing may get as far as decoding: a call here fails the test. */
const NO_DECODER: Images = {
  read: () => { throw new Error('nothing should be decoded here'); },
  toSmallPng: () => { throw new Error('nothing should be resized here'); },
};

// A picture cache file is named for what is in it, not where it came from.
const stamp = (inner: string, crc: number) => crypto.createHash('sha1').update(`${inner}:${crc}`).digest('hex').slice(0, 16);

/** A four-channel picture, alpha last, that `worthShowing` can be handed. */
function bitmap(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, data };
}

// ---------- which file to show ----------

// The paths are the real ones: a hero skin carrying selection art, a portrait and spell icons.
const SKIN = [
  'panorama/images/spellicons/wisp_tether_png.vtex_c',
  'panorama/images/heroes/npc_dota_hero_wisp_png.vtex_c',
  'panorama/images/heroes/selection/npc_dota_hero_wisp_png.vtex_c',
  'panorama/images/heroes/icons/npc_dota_hero_wisp_png.vtex_c',
  'materials/models/heroes/wisp/wisp_color_png_1234abcd.vtex_c',
  'materials/default/default_color_tga_41192599.vtex_c',
  'particles/units/heroes/hero_wisp/wisp_ambient.vpcf_c',
];

test('art is the picture the author drew, best first', () => {
  assert.equal(pickCandidate(SKIN, 'art'), 'panorama/images/heroes/selection/npc_dota_hero_wisp_png.vtex_c');
  // no selection art: the hero portrait, and only then the small icons
  assert.equal(
    pickCandidate(SKIN.filter((p) => !p.includes('/selection/')), 'art'),
    'panorama/images/heroes/npc_dota_hero_wisp_png.vtex_c',
  );
  assert.equal(
    pickCandidate(['panorama/images/spellicons/wisp_tether_png.vtex_c'], 'art'),
    'panorama/images/spellicons/wisp_tether_png.vtex_c',
  );
});

test('a texture is the model\'s own colour, never the exporter\'s filler', () => {
  assert.equal(pickCandidate(SKIN, 'texture'), 'materials/models/heroes/wisp/wisp_color_png_1234abcd.vtex_c');
  // "default_color" is what the exporter drops in, so it loses to anything of the mod's own
  assert.equal(
    pickCandidate(['materials/default/default_color_tga_41192599.vtex_c', 'materials/tree_topiary_texture_png_6834bd45.vtex_c'], 'texture'),
    'materials/tree_topiary_texture_png_6834bd45.vtex_c',
  );
});

test('the hero\'s own animated portrait is the video worth taking a frame from', () => {
  const withVideo = [
    'panorama/videos/heroes/npc_dota_hero_wisp.webm',
    'panorama/videos/misc/background_loop.webm',
    'panorama/images/heroes/selection/npc_dota_hero_wisp_png.vtex_c',
  ];
  assert.equal(pickCandidate(withVideo, 'video'), 'panorama/videos/heroes/npc_dota_hero_wisp.webm');
  // any panorama video will do when there is no portrait
  assert.equal(pickCandidate(['panorama/videos/misc/background_loop.webm'], 'video'), 'panorama/videos/misc/background_loop.webm');
  // and a mod with no video says so rather than offering a texture
  assert.equal(pickCandidate(['panorama/images/heroes/selection/x_png.vtex_c'], 'video'), null);
});

test('a normal map is a pile of numbers, not a picture of anything', () => {
  // caught in the sandbox: a tree mod carries its colour art and its normal map side by side
  // under the same name, the normal map came first in the tree, and the mod ended up with no
  // picture at all because flat lavender noise is rightly refused by worthShowing
  const trees = [
    'materials/tree_topiary_normals_png_b25ef11b.vtex_c',
    'materials/tree_topiary_texture_png_6834bd45.vtex_c',
  ];
  assert.equal(pickCandidate(trees, 'texture'), 'materials/tree_topiary_texture_png_6834bd45.vtex_c');
  // and a mod that has nothing but data maps offers nothing
  assert.equal(pickCandidate(['materials/models/heroes/x/x_mask_png_1.vtex_c', 'materials/models/heroes/x/x_roughness_png_2.vtex_c'], 'texture'), null);
});

test('the two kinds never answer for each other', () => {
  // panorama art is asked for as art; a mod with only art has no texture to offer
  assert.equal(pickCandidate(['panorama/images/heroes/selection/x_png.vtex_c'], 'texture'), null);
  assert.equal(pickCandidate(['materials/models/heroes/wisp/wisp_color_png_1.vtex_c'], 'art'), null);
});

test('a mod of particles and models has no picture in it at all', () => {
  // 46 of the 96 real mods measured look like this; there is genuinely nothing to show
  assert.equal(pickCandidate(['particles/units/heroes/hero_wisp/wisp_ambient.vpcf_c', 'models/props_tree/dire_tree001.vmdl_c'], 'art'), null);
  assert.equal(pickCandidate(['particles/units/heroes/hero_wisp/wisp_ambient.vpcf_c', 'models/props_tree/dire_tree001.vmdl_c'], 'texture'), null);
});

test('the same mod always yields the same picture', () => {
  const forward = pickCandidate(SKIN, 'art');
  assert.equal(pickCandidate([...SKIN].reverse(), 'art'), forward, 'a tie must not depend on tree order');
});

// ---------- whether it is worth showing ----------

test('a mod that strips a hero ships an empty texture, and empty is not a picture', () => {
  // "Bare Brewmaster" removes the armour: its only texture decodes perfectly and shows nothing
  assert.equal(worthShowing(bitmap(512, 512, () => [255, 255, 255, 0])), false);
  // a lone visible speck is not a picture either
  assert.equal(worthShowing(bitmap(512, 512, (x, y) => (x < 4 && y < 4 ? [200, 30, 30, 255] : [0, 0, 0, 0]))), false);
});

test('one flat colour is not worth a tile', () => {
  assert.equal(worthShowing(bitmap(256, 256, () => [90, 40, 120, 255])), false);
  // near-flat counts as flat: compression noise must not pass for content
  assert.equal(worthShowing(bitmap(256, 256, (x) => [90 + (x % 3), 40, 120, 255])), false);
});

test('a picture with something in it passes', () => {
  assert.equal(worthShowing(bitmap(256, 256, (x, y) => [x % 256, y % 256, 128, 255])), true);
});

test('too small to look at is refused', () => {
  assert.equal(worthShowing(bitmap(16, 16, (x, y) => [x * 16, y * 16, 0, 255])), false);
  assert.equal(worthShowing({ width: 0, height: 0, data: Buffer.alloc(0) }), false);
  // a claim of size that the pixels do not back up
  assert.equal(worthShowing({ width: 256, height: 256, data: Buffer.alloc(64) }), false);
});

// ---------- what happens around the toolchain ----------

test('without the toolchain there are no pictures and no complaints', async (t) => {
  const previews = createModPreviews({
    userDataDir: userDir(t), toolchain: noTool, langFileOf: (r) => r, images: NO_DECODER,
  });
  assert.equal(previews.ready(), false);
  assert.deepEqual(await previews.getMany(['modart:pak54_dir.vpk']), {});
});

test('keys that belong to somebody else are left alone', async (t) => {
  const previews = createModPreviews({
    // an executable that would throw if it were ever run: nothing here may reach it
    userDataDir: userDir(t), toolchain: withTool('C:/nowhere/tool.exe'), langFileOf: (r) => r, images: NO_DECODER,
  });
  assert.deepEqual(await previews.getMany(['hero:Brewmaster', 'generic:cursor', 'Weather Ash']), {});
});

test('a cached picture is found by content, so moving the mod to another slot keeps it', async (t) => {
  const dir = userDir(t);
  const lang = path.join(dir, 'lang');
  fs.mkdirSync(lang, { recursive: true });

  const inner = 'panorama/images/heroes/selection/npc_dota_hero_wisp_png.vtex_c';
  const buf = vpk.buildVpk([entry(inner, 'compiled texture bytes'), entry('particles/wisp.vpcf_c', 'fx')]);
  fs.writeFileSync(path.join(lang, 'pak24_dir.vpk'), buf);

  const previews = createModPreviews({
    userDataDir: dir,
    toolchain: withTool('C:/nowhere/tool.exe'),
    langFileOf: (rel) => path.join(lang, rel),
    images: NO_DECODER,
  });
  // the picture the decoder would have produced, already in the cache
  fs.mkdirSync(previews.root, { recursive: true });
  const cached = path.join(previews.root, `${stamp(inner, crc32(Buffer.from('compiled texture bytes')) >>> 0)}.png`);
  fs.writeFileSync(cached, Buffer.from('pretend png'));

  const got = await previews.getMany(['modart:pak24_dir.vpk']);
  assert.match(got['modart:pak24_dir.vpk'], /^data:image\/png;base64,/);

  // the same mod, moved to another pak slot: same bytes, so the same cached picture and no
  // trip to the decoder (which does not exist here and would throw)
  fs.renameSync(path.join(lang, 'pak24_dir.vpk'), path.join(lang, 'pak31_dir.vpk'));
  const moved = await previews.getMany(['modart:pak31_dir.vpk']);
  assert.equal(moved['modart:pak31_dir.vpk'], got['modart:pak24_dir.vpk']);
});

test('a mod already known to have nothing is not looked at twice', async (t) => {
  const dir = userDir(t);
  const lang = path.join(dir, 'lang');
  fs.mkdirSync(lang, { recursive: true });
  const inner = 'materials/models/heroes/brewmaster/brewmaster_armor_color_psd_f3d0b44a.vtex_c';
  fs.writeFileSync(path.join(lang, 'pak54_dir.vpk'), vpk.buildVpk([entry(inner, 'empty texture')]));

  const previews = createModPreviews({
    userDataDir: dir,
    toolchain: withTool('C:/nowhere/tool.exe'),
    langFileOf: (rel) => path.join(lang, rel),
    images: NO_DECODER,
  });
  fs.mkdirSync(previews.root, { recursive: true });
  fs.writeFileSync(path.join(previews.root, `${stamp(inner, crc32(Buffer.from('empty texture')) >>> 0)}.none`), '');

  // the marker answers instead of the decoder, which is not on disk and would have thrown
  assert.deepEqual(await previews.getMany(['modtex:pak54_dir.vpk']), {});
});

test('a video is handed to the window without the toolchain being involved', async (t) => {
  // this is the whole point of doing it in the window: the app carries a video decoder
  // already, so a mod's own clip works on a machine that never downloaded anything
  const dir = userDir(t);
  const lang = path.join(dir, 'lang');
  fs.mkdirSync(lang, { recursive: true });
  const inner = 'panorama/videos/heroes/npc_dota_hero_wisp.webm';
  const body = 'pretend webm bytes';
  fs.writeFileSync(path.join(lang, 'pak24_dir.vpk'), vpk.buildVpk([entry(inner, body)]));

  const previews = createModPreviews({
    userDataDir: dir, toolchain: noTool, langFileOf: (rel) => path.join(lang, rel), images: NO_DECODER,
  });
  assert.equal(previews.ready(), false, 'no toolchain here');
  const got = previews.videoBytes('modvid:pak24_dir.vpk');
  assert.equal(got?.bytes.toString(), body);
  // and a mod without a video is not offered as one
  assert.equal(previews.videoBytes('modart:pak24_dir.vpk'), null, 'only the video key answers');
});

test('a frame is kept only if it is worth looking at', async (t) => {
  const dir = userDir(t);
  const lang = path.join(dir, 'lang');
  fs.mkdirSync(lang, { recursive: true });
  const inner = 'panorama/videos/heroes/npc_dota_hero_wisp.webm';
  fs.writeFileSync(path.join(lang, 'pak24_dir.vpk'), vpk.buildVpk([entry(inner, 'pretend webm')]));

  // stands in for the window's decoder: the first frame is black, the second has a picture
  let next = { width: 256, height: 256, data: Buffer.alloc(256 * 256 * 4, 0) };
  const images = { read: () => next, toSmallPng: () => Buffer.from('small png') };
  const previews = createModPreviews({
    userDataDir: dir, toolchain: noTool, langFileOf: (rel) => path.join(lang, rel), images,
  });

  const key = 'modvid:pak24_dir.vpk';
  assert.equal(previews.saveFrame(key, Buffer.from('black frame')), null, 'a fade from black is not a picture');
  assert.equal(previews.videoBytes(key), null, 'and the mod is not asked for again');

  // a mod whose frame did land keeps it, and it is what getMany answers with from then on
  previews.clear();
  next = bitmap(256, 256, (x, y) => [x % 256, y % 256, 90, 255]);
  assert.match(previews.saveFrame(key, Buffer.from('a real frame')) ?? '', /^data:image\/png;base64,/);
  assert.match((await previews.getMany([key]))[key], /^data:image\/png;base64,/);
});

test('a key is a file in the mod folder and cannot point anywhere else', async (t) => {
  const dir = userDir(t);
  let asked = null;
  const previews = createModPreviews({
    userDataDir: dir,
    toolchain: withTool('C:/nowhere/tool.exe'),
    langFileOf: (rel) => { asked = rel; return path.join(dir, rel); },
    images: NO_DECODER,
  });
  for (const bad of ['../../../windows/win.ini', '..\\secrets.txt', 'C:/windows/win.ini', '/etc/passwd']) {
    assert.deepEqual(await previews.getMany([`modart:${bad}`]), {});
    assert.equal(previews.videoBytes(`modvid:${bad}`), null);
  }
  assert.equal(asked, null, 'nothing that shaped ever became a path');
  // and the shapes a mod really has still work
  fs.mkdirSync(path.join(dir, 'maps'), { recursive: true });
  await previews.getMany(['modart:pak24_dir.vpk', 'modart:maps/dota.vpk']);
  assert.ok(asked, 'a real relative path is looked up');
});

test('a mod whose file is gone is a miss, not a crash', async (t) => {
  const dir = userDir(t);
  const previews = createModPreviews({
    userDataDir: dir, toolchain: withTool('C:/nowhere/tool.exe'), langFileOf: (rel) => path.join(dir, rel), images: NO_DECODER,
  });
  assert.deepEqual(await previews.getMany(['modart:pak99_dir.vpk']), {});
  // and neither is a file that is not a VPK at all
  fs.writeFileSync(path.join(dir, 'pak98_dir.vpk'), 'not a vpk');
  assert.deepEqual(await previews.getMany(['modart:pak98_dir.vpk']), {});
});

test('the cache reports what it holds and clears completely', (t) => {
  const dir = userDir(t);
  const previews = createModPreviews({
    userDataDir: dir, toolchain: noTool, langFileOf: (r) => r, images: NO_DECODER,
  });
  fs.mkdirSync(previews.root, { recursive: true });
  fs.writeFileSync(path.join(previews.root, 'abc.png'), Buffer.from('pretend png'));
  assert.equal(previews.size(), 11);
  previews.clear();
  assert.equal(previews.size(), 0);
  assert.equal(fs.existsSync(previews.root), false);
});

// ---------- decoding, with the texture tool played by the test ----------

/** A mod folder of `count` mods, each with drawn art whose bytes say which mod it is. */
function modsWithArt(t: TestContext, count: number) {
  const dir = userDir(t);
  const lang = path.join(dir, 'lang');
  fs.mkdirSync(lang, { recursive: true });
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const slot = `pak${String(30 + i).padStart(2, '0')}_dir.vpk`;
    fs.writeFileSync(path.join(lang, slot), vpk.buildVpk([entry('panorama/images/heroes/selection/npc_dota_hero_wisp_png.vtex_c', `art of mod ${i}`)]));
    keys.push(`modart:${slot}`);
  }
  return { dir, lang, keys };
}

/** The tool: writes <stem>.png beside each staged texture whose bytes `decodes` accepts, holding those bytes. */
function fakeTool(decodes: (bytes: string) => boolean = () => true) {
  const calls: string[][] = [];
  const run = async (_exe: string, args: string[]) => {
    calls.push(args);
    const folder = args[args.indexOf('-i') + 1];
    for (const f of fs.readdirSync(folder)) {
      if (!f.endsWith('.vtex_c')) continue;
      const bytes = fs.readFileSync(path.join(folder, f), 'utf8');
      if (decodes(bytes)) fs.writeFileSync(path.join(folder, f.replace(/\.vtex_c$/, '.png')), bytes);
    }
  };
  return { run, calls };
}

/** Pictures whose pixels are busy unless the file says "flat"; resizing keeps the text so the cache can be read back. */
const DECODER: Images = {
  read: (file) => {
    const text = fs.readFileSync(file, 'utf8');
    return { ...bitmap(64, 64, (x, y) => (text.includes('flat') ? [10, 10, 10, 255] : [x * 4, y * 4, 128, 255])), img: text };
  },
  toSmallPng: (bmp) => Buffer.from(`small ${bmp.img}`),
};

test('a screenful of mods is decoded in one call, and each picture is its own mod\'s', async (t) => {
  const m = modsWithArt(t, 3);
  const tool = fakeTool();
  const previews = createModPreviews({ userDataDir: m.dir, toolchain: withTool('C:/tool.exe'), langFileOf: (rel) => path.join(m.lang, rel), images: DECODER, run: tool.run });

  // the same key twice wants one picture, decoded once
  const got = await previews.getMany([...m.keys, m.keys[0]]);
  assert.equal(tool.calls.length, 1, 'one call for the whole batch');
  m.keys.forEach((key, i) => {
    assert.equal(Buffer.from(got[key].split(',')[1], 'base64').toString(), `small art of mod ${i}`, key);
  });
  // cached: asked again, nothing is decoded
  await previews.getMany(m.keys);
  assert.equal(tool.calls.length, 1);
});

test('what the tool could not decode, or decoded to one flat colour, is remembered and not decoded again', async (t) => {
  const m = modsWithArt(t, 2);
  fs.writeFileSync(path.join(m.lang, 'pak30_dir.vpk'), vpk.buildVpk([entry('panorama/images/heroes/selection/npc_dota_hero_wisp_png.vtex_c', 'flat art')]));
  const tool = fakeTool((bytes) => bytes !== 'art of mod 1');
  const previews = createModPreviews({ userDataDir: m.dir, toolchain: withTool('C:/tool.exe'), langFileOf: (rel) => path.join(m.lang, rel), images: DECODER, run: tool.run });

  assert.deepEqual(await previews.getMany(m.keys), {});
  assert.deepEqual(await previews.getMany(m.keys), {});
  assert.equal(tool.calls.length, 1, 'both misses are on disk now');
});

test('a tool that fails is logged, nothing is marked as missing, and the next ask tries again', async (t) => {
  const m = modsWithArt(t, 1);
  const said: string[] = [];
  let fail = true;
  const tool = fakeTool();
  const run = async (exe: string, args: string[]) => { if (fail) throw new Error('vrf crashed'); return tool.run(exe, args); };
  const previews = createModPreviews({ userDataDir: m.dir, toolchain: withTool('C:/tool.exe'), langFileOf: (rel) => path.join(m.lang, rel), images: DECODER, run, log: (s) => said.push(s) });

  assert.deepEqual(await previews.getMany(m.keys), {});
  assert.ok(said.some((s) => /extraction failed.*vrf crashed/.test(s)), said.join('; '));
  fail = false;
  assert.equal(Object.keys(await previews.getMany(m.keys)).length, 1, 'a crash is not a verdict on the mod');
});

test('more than forty pictures go to the tool forty at a time', async (t) => {
  const m = modsWithArt(t, 41);
  const tool = fakeTool();
  const previews = createModPreviews({ userDataDir: m.dir, toolchain: withTool('C:/tool.exe'), langFileOf: (rel) => path.join(m.lang, rel), images: DECODER, run: tool.run });
  assert.equal(Object.keys(await previews.getMany(m.keys)).length, 41);
  assert.equal(tool.calls.length, 2);
});

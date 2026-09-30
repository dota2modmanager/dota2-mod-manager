// VPK reader/writer. Everything the app knows about a mod comes through here: what it
// contains, which hero it touches, and the content fingerprint used to recognise a foreign
// file as a catalog mod. The writer is exercised against the reader, so a change that breaks
// the round trip fails here instead of producing paks the game silently ignores.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';

import * as vpk from '../src/vpk.ts';
import { entry } from './helpers/vpk-entry.ts';
import { heroIdFromName } from '../src/hero-names.ts';

const SAMPLE: [string, string][] = [
  ['models/heroes/crystal_maiden/crystal_maiden.vmdl_c', 'base model'],
  ['models/items/crystal_maiden/cm_screeauk/cm_screeauk_head.vmdl_c', 'head piece'],
  ['materials/models/heroes/crystal_maiden/crystal_maiden.vmat_c', 'material'],
  ['particles/econ/items/crystal_maiden/frost_arcana.vpcf_c', 'particles'],
  ['scripts/items/items_game.txt', '"items_game" { }'],
];

const buildSample = () => vpk.buildVpk(SAMPLE.map(([p, b]) => entry(p, b)));

test('a built VPK reads back with every path intact', () => {
  const paths = vpk.listVpkPaths(buildSample());
  assert.deepEqual(paths.sort(), SAMPLE.map(([p]) => p).sort());
});

test('a built VPK reads back with every file byte for byte', () => {
  const buf = buildSample();
  const entries = vpk.readVpkEntries(buf, 'mem');
  const byPath = new Map(entries.map((e) => [vpk.entryPath(e), e.data.toString()]));

  assert.equal(byPath.size, SAMPLE.length);
  for (const [p, body] of SAMPLE) assert.equal(byPath.get(p), body, p);
});

test('a file at the archive root survives the round trip', () => {
  const buf = vpk.buildVpk([entry('readme.txt', 'top level')]);
  assert.deepEqual(vpk.listVpkPaths(buf), ['readme.txt']);
  assert.equal(vpk.readVpkEntries(buf, 'mem')[0].data.toString(), 'top level');
});

test('an empty file survives the round trip', () => {
  const buf = vpk.buildVpk([entry('materials/blank.vtex_c', '')]);
  assert.deepEqual(vpk.listVpkPaths(buf), ['materials/blank.vtex_c']);
  assert.equal(vpk.readVpkEntries(buf, 'mem')[0].data.length, 0);
});

test('the recorded CRC is the CRC of the bytes', () => {
  const buf = buildSample();
  for (const e of vpk.listVpkEntries(buf)) {
    const hit = SAMPLE.find(([p]) => p === e.path);
    assert.ok(hit, `${e.path} is not in the sample`);
    const [, body] = hit;
    assert.equal(e.crc >>> 0, crc32(Buffer.from(body)) >>> 0, e.path);
  }
});

test('anything that is not a VPK is rejected rather than parsed', () => {
  assert.throws(() => vpk.listVpkPaths(Buffer.from('not a vpk at all')));
  assert.throws(() => vpk.listVpkPaths(Buffer.alloc(4)));
});

test('the fingerprint ignores packaging and depends only on content', () => {
  const forward = vpk.buildVpk(SAMPLE.map(([p, b]) => entry(p, b)));
  const reversed = vpk.buildVpk([...SAMPLE].reverse().map(([p, b]) => entry(p, b)));

  // Same files, different order inside the archive: the same mod, so the same fingerprint.
  assert.equal(vpk.fingerprintVpk(forward), vpk.fingerprintVpk(reversed));
});

test('the fingerprint changes when any file content changes', () => {
  const base = buildSample();
  const tweaked = vpk.buildVpk(
    SAMPLE.map(([p, b]) => entry(p, p.endsWith('.vmat_c') ? `${b} edited` : b))
  );

  assert.notEqual(vpk.fingerprintVpk(base), vpk.fingerprintVpk(tweaked));
});

test('loose-file fingerprints are order independent', () => {
  const files = [
    { path: 'cursor/arrow.ani', data: Buffer.from('a') },
    { path: 'cursor/hand.ani', data: Buffer.from('b') },
  ];
  assert.equal(vpk.fingerprintFiles(files), vpk.fingerprintFiles([...files].reverse()));
});

test('a base hero model is read as a base override, an item as a slot', () => {
  const analysis = vpk.analyzeVpkPaths(SAMPLE.map(([p]) => p));
  const cm = analysis.heroes.find((h) => h.id === 'crystal_maiden');

  assert.ok(cm, 'crystal_maiden should be recognised');
  assert.equal(cm.base, true, 'models/heroes/<hero>/<hero>.vmdl_c replaces the base model');
  assert.ok(cm.slots.length > 0, 'the item piece contributes a slot');
});

test('analysis of an empty path list says so instead of guessing a hero', () => {
  const analysis = vpk.analyzeVpkPaths([]);
  assert.deepEqual(analysis.heroes, []);
  assert.equal(analysis.pathCount, 0);
});

test('a hero whose folder only lent a texture is not what the mod is about', () => {
  // Real shape, from a set that dresses Grimstroke alone: authors borrow generic lookup
  // textures (fresnel warps, colourwarps, detail masks) out of other heroes' folders, and
  // counting each of those as a hero announced the set as a bundle of eight. Measured over
  // 84 installed mods: 12 heroes invented across 5 of them.
  const analysis = vpk.analyzeVpkPaths([
    'models/items/grimstroke/gs_armor/gs_armor.vmdl_c',
    'materials/models/heroes/mars/mars_volume_smoke_normal_png_b0f6b990.vtex_c',
    'materials/models/heroes/puck/puck_colorwarp3d_z002_tga_d0a36816.vtex_c',
  ]);
  assert.equal(analysis.heroes.length, 3, 'all three are still seen');
  assert.equal(vpk.nameFromAnalysis(analysis), 'Grimstroke', 'only the one it carries a model for names it');
  assert.equal(vpk.describeAnalysis(analysis).includes('Mars'), false);
  assert.deepEqual(vpk.subjectHeroes(analysis).map((h) => h.id), ['grimstroke']);
});

test('a persona is the hero it belongs to, not a hero of its own', () => {
  // Real shape, from a Skinchanger pack that dresses Anti-Mage: the game files his Wei
  // persona under models/heroes/antimage_female, so one skin came in reading as two heroes
  // — named "Antimage, Antimage Female", and split in half on import, because an import of
  // two to four heroes splits itself.
  const analysis = vpk.analyzeVpkPaths([
    'models/heroes/antimage/antimage.vmdl_c',
    'models/heroes/antimage_female/am_persona_body.vmdl_c',
    'particles/units/heroes/hero_antimage_female/am_persona_blink.vpcf_c',
  ]);
  assert.deepEqual(vpk.subjectHeroes(analysis).map((h) => h.name), ['Anti-Mage']);
  assert.equal(vpk.nameFromAnalysis(analysis), 'Anti-Mage');
});

test('a prop borrowed from another hero is not a second subject', () => {
  // Real shape, from a Clinkz set that hangs a Phoenix immortal off its bow. One model of
  // his against five of Clinkz's used to read as two heroes, so the mod came in named
  // "Clinkz, Phoenix" and split itself in half on import, bow in one part and hero in the
  // other. Measured across 75 split mods: every borrowed prop was one model against five or
  // more, and no real two-hero pack came near a quarter.
  const analysis = vpk.analyzeVpkPaths([
    'models/heroes/clinkz/clinkz_head.vmdl_c',
    'models/heroes/clinkz/clinkz_horns.vmdl_c',
    'models/heroes/clinkz/clinkz_pads.vmdl_c',
    'models/items/clinkz/clinkz_ti9_immortal_weapon/clinkz_ti9_immortal_weapon.vmdl_c',
    'models/items/clinkz/clinkz_ti9_immortal_back/clinkz_ti9_immortal_back.vmdl_c',
    'models/items/phoenix/phoenix_ti10_immortal_back/phoenix_ti10_immortal_icarus_dive_fx.vmdl_c',
  ]);
  assert.equal(analysis.heroes.length, 2, 'both are still seen');
  assert.deepEqual(vpk.subjectHeroes(analysis).map((h) => h.name), ['Clinkz']);
  assert.equal(vpk.nameFromAnalysis(analysis), 'Clinkz');
});

test('two heroes a pack really dresses both stay subjects', () => {
  const analysis = vpk.analyzeVpkPaths([
    'models/heroes/pudge/pudge.vmdl_c',
    'models/items/pudge/pudge_arcana/pudge_arcana_head.vmdl_c',
    'models/items/pudge/pudge_arcana/pudge_arcana_belt.vmdl_c',
    'models/heroes/juggernaut/juggernaut.vmdl_c',
    'models/items/juggernaut/jugg_arcana/jugg_arcana_weapon.vmdl_c',
  ]);
  assert.deepEqual(vpk.subjectHeroes(analysis).map((h) => h.name).sort(), ['Juggernaut', 'Pudge']);
});

test('splitting refuses a mod that only borrowed a prop from another hero', () => {
  // The split decision has to agree with what the mod is about, or the two disagree and the
  // set comes apart anyway: naming said "Clinkz" while splitting still counted Phoenix and
  // cut the bow off into a mod of its own.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpk-split-'));
  try {
    const one = path.join(dir, 'one_dir.vpk');
    fs.writeFileSync(one, vpk.buildVpk([
      entry('models/heroes/clinkz/clinkz_head.vmdl_c', 'a'),
      entry('models/heroes/clinkz/clinkz_horns.vmdl_c', 'b'),
      entry('models/heroes/clinkz/clinkz_pads.vmdl_c', 'c'),
      entry('models/items/clinkz/ti9_weapon/ti9_weapon.vmdl_c', 'd'),
      entry('models/items/clinkz/ti9_back/ti9_back.vmdl_c', 'e'),
      entry('models/items/phoenix/ti10_back/ti10_icarus_fx.vmdl_c', 'f'),
    ]));
    assert.deepEqual(vpk.splitVpkByHero(one), [], 'one borrowed prop is not a second mod');

    const two = path.join(dir, 'two_dir.vpk');
    fs.writeFileSync(two, vpk.buildVpk([
      entry('models/heroes/pudge/pudge.vmdl_c', 'a'),
      entry('models/items/pudge/arcana/arcana_head.vmdl_c', 'b'),
      entry('models/items/pudge/arcana/arcana_belt.vmdl_c', 'c'),
      entry('models/heroes/juggernaut/juggernaut.vmdl_c', 'd'),
      entry('models/items/juggernaut/arcana/arcana_weapon.vmdl_c', 'e'),
    ]));
    assert.deepEqual(vpk.splitVpkByHero(two).map((p) => p.name).sort(), ['Juggernaut', 'Pudge']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('folder names the game kept from before a rename resolve to the hero', () => {
  for (const [folder, name] of [['bard', 'Largo'], ['invoker_kid', 'Invoker'], ['lanaya', 'Templar Assassin'],
    ['drow', 'Drow Ranger'], ['gyro', 'Gyrocopter'], ['tuskarr', 'Tusk'], ['pudge_cute', 'Pudge']]) {
    assert.equal(vpk.heroDisplayName(folder), name, folder);
  }
});

test('a mod that carries no models at all is still named by what it recolours', () => {
  // a plain retexture owns no model, so there is no better answer than the hero it paints
  const analysis = vpk.analyzeVpkPaths([
    'materials/models/heroes/brewmaster/brewmaster_armor_color_psd_f3d0b44a.vtex_c',
  ]);
  assert.equal(vpk.nameFromAnalysis(analysis), 'Brewmaster');
});

test('folders the game uses for non-hero content are not read as heroes', () => {
  // "models/heroes/announcer/..." and friends are content buckets, not heroes; treating them
  // as one would put an announcer pack under a hero name in the library.
  const analysis = vpk.analyzeVpkPaths([
    'models/heroes/announcer/announcer.vmdl_c',
    'models/heroes/terrain/terrain.vmdl_c',
  ]);
  assert.deepEqual(analysis.heroes.map((h) => h.id), []);
});

test('the seeking index answers exactly what the one-file reader does', () => {
  // The cosmetics picker pulls dozens of item pictures out of the game's own pak01, whose
  // tree holds 384 001 entries: walking it per picture costs seconds, so the index is built
  // once and read by seek. It has to agree with readVpkEntryFile down to the byte, or the
  // pictures come out of the wrong offsets and nobody can tell from the outside.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpk-index-'));
  try {
    const file = path.join(dir, 'pak_dir.vpk');
    const bodies = new Map([
      ['panorama/images/econ/items/abaddon/blade/blade_png.vtex_c', 'a picture'],
      ['scripts/items/items_game.txt', 'the item table'],
      ['models/heroes/pudge/pudge.vmdl_c', 'a model'],
      ['sounds/weapons/hit.vsnd_c', ''],
    ]);
    fs.writeFileSync(file, vpk.buildVpk([...bodies].map(([p, body]) => entry(p, body))));

    const ix = vpk.openVpkIndex(file);
    assert.equal(ix.size, bodies.size);
    for (const [p, body] of bodies) {
      assert.ok(ix.has(p), `${p} should be in the index`);
      assert.equal(ix.read(p)?.toString(), body, p);
      assert.deepEqual(ix.read(p), vpk.readVpkEntryFile(file, p)?.data, p);
    }
    // asked in the case the caller happens to have, not the case the tree stores
    assert.equal(ix.read('SCRIPTS/Items/Items_Game.TXT')?.toString(), 'the item table');
    assert.equal(ix.has('models/heroes/pudge/nothing.vmdl_c'), false);
    assert.equal(ix.read('models/heroes/pudge/nothing.vmdl_c'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The catalog's hero grid asks for portraits by the name it prints; the game files them under
// ids that can look nothing like it.
test('a hero named the way the catalog names it finds the game id', () => {
  const cases = {
    'Anti-Mage': 'antimage', 'Queen of Pain': 'queenofpain', "Nature's Prophet": 'furion',
    'Natures Prophet': 'furion', 'Wraith King': 'skeleton_king', Io: 'wisp', Doom: 'doom_bringer',
    'Monkey King': 'monkey_king', Abaddon: 'abaddon', 'Treant Protector': 'treant', Centaur: 'centaur',
  };
  for (const [name, id] of Object.entries(cases)) assert.equal(heroIdFromName(name), id, name);
  assert.equal(heroIdFromName(''), null);
});

test('two spellings of one hero are one hero, under the name the game uses, whichever comes first', () => {
  /* An author's own folder name ("crystalmaiden") and the game's ("crystal_maiden") in one pack.
     Merged, the hero keeps the game's id, because splitting a pack looks for the hero's files by
     it. Written in both orders: the one where the author's spelling comes first was reached only
     by the random paths of vpk-fuzz.test.ts, so it was covered on some runs and not on others. */
  const alias = 'models/heroes/crystalmaiden/crystalmaiden_arms.vmdl_c';
  const canonical = 'models/heroes/crystal_maiden/crystal_maiden.vmdl_c';
  for (const paths of [[alias, canonical], [canonical, alias]]) {
    const { heroes, kind } = vpk.analyzeVpkPaths(paths);
    assert.equal(kind, 'hero');
    assert.equal(heroes.length, 1, `one hero from ${paths.join(' + ')}`);
    assert.equal(heroes[0].id, 'crystal_maiden');
    assert.equal(heroes[0].name, 'Crystal Maiden');
    assert.equal(heroes[0].models, 2);
  }
});

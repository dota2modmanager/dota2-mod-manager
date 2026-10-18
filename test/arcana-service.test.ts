/* The arcana window's side in the main process (src/arcana-service.ts), issue #118: what the window
 * is told, the mod it builds into My mods, building it again in its place, and building it again
 * after a Dota update with the colour it had and the switch where it was. On a game folder made
 * here, with a pak01 holding the few files the build reads (test/helpers/kv3-build.ts).
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, openVpkIndex } from '../src/vpk.ts';
import { readKv3, readCell } from '../src/kv3.ts';
import { dataBlock } from '../src/resource.ts';
import { createArcanaService, hex, validColor } from '../src/arcana-service.ts';
import { encodeKv3, host, model, particle, remap, rerl, resource } from './helpers/kv3-build.ts';
import type { LibRecord } from '../src/types.ts';

const ARCANA = 'particles/econ/items/terrorblade/terrorblade_horns_arcana';
const HERO = 'particles/units/heroes/hero_terrorblade';
const DREADHUNT = 'particles/econ/items/terrorblade/dreadhunt';

/** A picture as the game ships one: a resource header, then a whole PNG file. */
function picture(): Buffer {
  const head = Buffer.alloc(16);
  head.writeUInt32LE(16, 0);
  return Buffer.concat([head, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixelsIEND'), Buffer.alloc(4)]);
}

/** A game folder whose pak01 has the arcana's model, picture, eyes and one tinted particle. */
function world(t: TestContext, { withArcana = true, bases, code }: { withArcana?: boolean; bases?: Parameters<typeof createArcanaService>[0]['bases']; code?: () => string | null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-arcana-service-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  const files = [entryAt('scripts/items/items_game.txt', Buffer.from('the game'))];
  if (withArcana) {
    files.push(
      entryAt('models/heroes/terrorblade/terrorblade_arcana.vmdl_c', model('models/heroes/terrorblade/terrorblade_arcana.vmdl')),
      entryAt('models/heroes/terrorblade/horns_arcana.vmdl_c', model('models/heroes/terrorblade/horns_arcana.vmdl')),
      entryAt('panorama/images/econ/heroes/terrorblade/arcana_terrorblade_png.vtex_c', picture()),
      entryAt(`${ARCANA}/terrorblade_ambient_eyes_arcana_horns.vpcf_c`, host([`${ARCANA}/terrorblade_ambient_eye_arcana_horns.vpcf`])),
      entryAt(`${HERO}/terrorblade_feet_effects.vpcf_c`, particle(encodeKv3({ obj: [['m_ConstantColor', { i32s: [85, 203, 252, 255] }], ['m_Initializers', { arr: [remap(15)] }]] }))),
      entryAt(`${DREADHUNT}/dreadhunt_arcana_head_ambient.vpcf_c`, host([`${DREADHUNT}/dreadhunt_arcana_head_ambient_glow.vpcf`])),
    );
  }
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk(files));
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  const said: string[] = [];
  const service = createArcanaService({ gamePath: () => game, installer, library, log: (m) => said.push(m), bases, code });
  return { game, lang, installer, library, service, said };
}

/** The colour the feet's flames start from, in the pak a record has. */
function feet(lang: string, rec: LibRecord): number[] {
  const pak = path.join(lang, rec.files[0].relPath + (rec.enabled === false ? '.off' : ''));
  const kv = readKv3(dataBlock(openVpkIndex(pak).read(`${HERO}/terrorblade_feet_effects.vpcf_c`) as Buffer).data);
  return kv.arrays.find((a) => a.key === 'm_ConstantColor')!.cells.slice(0, 3).map((c) => readCell(kv, c!));
}

test('a colour from the window is three whole numbers 0 to 255, and is written as hex', () => {
  assert.deepEqual(validColor([255, 60, 40]), [255, 60, 40]);
  for (const bad of [[256, 0, 0], [1, 2], ['255', 0, 0], [1.5, 0, 0], 'red', null]) assert.equal(validColor(bad), null, String(bad));
  assert.equal(hex([255, 193, 220]), '#ffc1dc');
});

test('the window is told whether the game has the arcana, and gets its picture', (t) => {
  const w = world(t);
  const s = w.service.state();
  assert.equal(s.available, true);
  assert.match(s.picture || '', /^data:image\/png;base64,/);
  assert.equal(s.installed, null);
  assert.equal(world(t, { withArcana: false }).service.state().available, false, 'a game without it offers nothing to build');
});

test('the arcana goes into My mods in an early slot, marked with what it was built from', (t) => {
  const w = world(t);
  const rec = w.service.install([255, 193, 220], 'mod');
  assert.equal(rec.categoryId, 'hero-items');
  assert.equal(rec.styleLabel, '#ffc1dc');
  assert.deepEqual(rec.generated, { set: 'terrorblade-arcana', color: [255, 193, 220], mode: 'mod' });
  const slot = Number(/^pak(\d+)_dir\.vpk$/.exec(rec.files[0].relPath)?.[1]);
  assert.ok(slot >= 2 && slot <= 29, `before the hero mods, not pak${slot}`);
  assert.deepEqual(feet(w.lang, rec), [255, 193, 220], 'with no gem, its colour written in');
  const pak = openVpkIndex(path.join(w.lang, rec.files[0].relPath));
  assert.ok(pak.read('models/heroes/terrorblade/terrorblade.vmdl_c'), "the arcana's model under the plain one's name");
  assert.deepEqual(w.service.state().installed, { id: rec.id, color: [255, 193, 220], mode: 'mod', enabled: true });
  assert.throws(() => w.service.install([300, 0, 0], 'mod'), /цвет|colour/i);
});

test('choosing again builds it again in its place, one record and one pak', (t) => {
  const w = world(t);
  const first = w.service.install([255, 193, 220], 'mod');
  const again = w.service.install([60, 120, 255], 'recolor');
  assert.equal(again.id, first.id);
  assert.deepEqual(again.files, first.files, 'the same slot');
  assert.equal(w.library.list().length, 1);
  assert.deepEqual(fs.readdirSync(w.lang).filter((f) => /^pak\d+/.test(f)), [first.files[0].relPath]);
  assert.deepEqual(again.generated, { set: 'terrorblade-arcana', color: [60, 120, 255], mode: 'recolor' });
  const pak = openVpkIndex(path.join(w.lang, again.files[0].relPath));
  assert.equal(pak.read('models/heroes/terrorblade/terrorblade.vmdl_c'), null, 'only the colour: no model in it');
});

test('a Dota update that reached it builds it again with its colour, and leaves it off if it was', (t) => {
  const w = world(t);
  const rec = w.service.install([255, 193, 220], 'mod');
  w.installer.setEnabled(rec.files, false, rec.id);
  w.library.update(rec.id, { enabled: false });
  const other = w.library.add({ name: 'Some hud', categoryId: 'huds', styleLabel: null, fileRef: null, preview: null, files: [] } as never) as LibRecord;
  assert.deepEqual(w.service.rebuild([rec.id, other.id]), [rec.id], 'only what it built');
  const after = w.library.find(rec.id) as LibRecord;
  assert.equal(after.enabled, false);
  assert.ok(fs.existsSync(path.join(w.lang, `${after.files[0].relPath}.off`)), 'off on disk too');
  assert.deepEqual(feet(w.lang, after), [255, 193, 220]);
  assert.deepEqual(w.service.rebuild([other.id]), [], 'a mod the update did not reach is left alone');
  assert.ok(w.said.some((m) => /after the update/.test(m)));
});

test("with Terrorblade's base here the whole arcana is built from it, in the chosen colour; until it is, from the game's", (t) => {
  const BODY = 'models/heroes/terrorblade/terrorblade.vmdl_c';
  let here = false;
  const wanted: string[] = [];
  const bases = {
    // the base's particle has the gem's red written in, as J0nathan550 compiled it
    entries: () => (here ? [
      entryAt(`${HERO}/terrorblade_feet_effects.vpcf_c`, particle(encodeKv3({ obj: [['m_ConstantColor', { i32s: [255, 60, 40, 255] }]] }))),
      entryAt(BODY, Buffer.from('the base body')),
    ] : null),
    want: async (id: string) => { wanted.push(id); return false; },
  };
  const w = world(t, { bases });
  const before = w.service.install([40, 120, 255], 'mod');
  assert.deepEqual(wanted, ['fractal_horns_of_inner_abysm']);
  const pakOf = (rec: LibRecord) => openVpkIndex(path.join(w.lang, rec.files[0].relPath));
  assert.notEqual(pakOf(before).read(BODY)?.toString(), 'the base body', "not here: Valve's model, as before");
  // Rictus Ripper's eye is the arcana's while both are worn: nothing in the game swaps it without the item
  const EYE = `${DREADHUNT}/dreadhunt_head_ambient.vpcf_c`;
  assert.ok(pakOf(before).read(EYE), "the arcana's eye under Rictus Ripper's");

  here = true;
  const rec = w.service.install([40, 120, 255], 'mod');
  assert.equal(pakOf(rec).read(BODY)?.toString(), 'the base body');
  assert.ok(pakOf(rec).read(EYE), "from the base too");
  const [r, g, b] = feet(w.lang, rec);
  assert.ok(b > r && b > g, `the base's red moved to blue, not ${[r, g, b]}`);
  assert.deepEqual(feet(w.lang, w.service.install([255, 60, 40], 'mod')), [255, 60, 40], 'in its own colour, as it was made');
  assert.equal(w.library.list().length, 1, 'one record all along');
});

/* Its pak loads ahead of the item builder's folder, so where both wrote a path the arcana won:
 * Rictus Ripper's head and demon came out as the arcana's (2026-10-19). A pick wins over a base,
 * the builder's own and this one alike. */
test("the arcana leaves the paths the item builder's picks fill to them, and takes them back once no pick does", (t) => {
  const HEAD = 'models/heroes/terrorblade/horns.vmdl_c';
  const DEMON = 'models/heroes/terrorblade/demon.vmdl_c';
  const BODY = 'models/heroes/terrorblade/terrorblade.vmdl_c';
  const bases = {
    entries: () => [entryAt(HEAD, Buffer.from('arcana head')), entryAt(DEMON, Buffer.from('arcana demon')), entryAt(BODY, Buffer.from('arcana body'))],
    want: async () => false,
  };
  const w = world(t, { bases });
  w.service.install([40, 120, 255], 'mod');
  const rec = () => w.library.list()[0];
  const has = (p: string) => Boolean(openVpkIndex(path.join(w.lang, rec().files[0].relPath)).read(p));

  assert.equal(w.service.giveWay(new Set([HEAD, DEMON, 'models/items/terrorblade/rictus/armor.vmdl_c'])), true);
  assert.deepEqual([has(HEAD), has(DEMON), has(BODY)], [false, false, true], 'the picks have the head and the demon, the arcana its body');
  assert.deepEqual((rec().generated as { under?: string[] }).under, [DEMON, HEAD]);
  assert.equal(w.service.giveWay(new Set([HEAD, DEMON])), false, 'the same picks: nothing to build');

  w.service.install([255, 0, 0], 'mod');
  assert.equal(has(HEAD), false, 'a new colour keeps what was left to the picks');

  assert.equal(w.service.giveWay(new Set([DEMON])), true);
  assert.deepEqual([has(HEAD), has(DEMON)], [true, false], 'the head picked off: the arcana has it again');
  w.service.giveWay(new Set());
  assert.equal((rec().generated as { under?: string[] }).under, undefined, 'the table taken off: all of it back');
  assert.equal(has(DEMON), true);
  assert.equal(w.library.list().length, 1, 'one record all along');
});

/* Its form's particle and the code that built it: Rictus Ripper's demon eye goes on the demon only
 * while the demon is picked, and an arcana installed before a fix is built again by the fixed code
 * instead of waiting for the next colour (2026-10-19: the eye's fix never reached the game). */
test('the arcana is built again when a pick whose form it dresses comes or goes, and when its code changes', (t) => {
  const META = `${HERO}/terrorblade_metamorphosis.vpcf_c`;
  const EYE = `${DREADHUNT}/dreadhunt_demon_ambient.vpcf`;
  let stamp = 'one';
  const w = world(t, { code: () => stamp });
  // the game's metamorphosis binds points to attachments and hands none, as in the game of 2026-10-19
  const meta = resource([['RERL', rerl([`${HERO}/terrorblade_metamorphosis_ambient.vpcf`])], ['DATA', encodeKv3({ obj: [
    ['m_Children', { arr: [{ obj: [['m_ChildRef', { ref: `${HERO}/terrorblade_metamorphosis_ambient.vpcf` }]] }] }],
    ['m_controlPointConfigurations', { arr: [{ obj: [['m_drivers', { arr: [
      { obj: [['m_entityName', { str: 'self' }]] },
      { obj: [['m_iControlPoint', { int: 1 }], ['m_attachmentName', { str: 'attach_hitloc' }], ['m_entityName', { str: 'self' }]] },
    ] }]] }] }],
  ] })]]);
  const pak01 = path.join(w.game, 'dota', 'pak01_dir.vpk');
  const index = openVpkIndex(pak01);
  const kept = [...index.paths()].map((p) => entryAt(p, index.read(p) as Buffer));
  fs.writeFileSync(pak01, buildVpk([...kept, entryAt(META, meta), entryAt(`${EYE}_c`, particle(encodeKv3({ obj: [['m_ColorMin', { i32s: [255, 86, 86, 255] }]] })))]));

  w.service.install([40, 120, 255], 'mod');
  const rec = () => w.library.list().find((r) => r.generated) as LibRecord;
  const carries = () => openVpkIndex(path.join(w.lang, rec().files[0].relPath)).read(META)?.toString('latin1').includes('dreadhunt_demon_ambient') ?? false;
  assert.equal(carries(), false, 'no demon picked: no eye on the metamorphosis');
  assert.equal((rec().generated as { code?: string }).code, 'one');
  assert.equal(w.service.giveWay(new Set()), false, 'nothing changed');

  const added = w.library.add({ name: 'Rictus Ripper - Demon', categoryId: 'cosmetic', styleLabel: null, fileRef: null, preview: null, files: [] });
  const demon = w.library.update(added.id, { slot: 'item:terrorblade:ability3', itemId: '31410' }) as LibRecord;
  assert.equal(w.service.giveWay(new Set()), true);
  assert.equal(carries(), true, "the demon picked: its eye on the metamorphosis");
  assert.ok(openVpkIndex(path.join(w.lang, rec().files[0].relPath)).read(`${EYE}_c`), 'and the eye in the colour, under its own path');

  stamp = 'two';
  assert.equal(w.service.giveWay(new Set()), true, 'new code builds it again');
  assert.equal((rec().generated as { code?: string }).code, 'two');

  w.library.update(demon.id, { enabled: false });
  assert.equal(w.service.giveWay(new Set()), true);
  assert.equal(carries(), false, 'the demon switched off: the eye goes with it');
});

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
import { encodeKv3, host, particle, remap } from './helpers/kv3-build.ts';
import type { LibRecord } from '../src/types.ts';

const ARCANA = 'particles/econ/items/terrorblade/terrorblade_horns_arcana';
const HERO = 'particles/units/heroes/hero_terrorblade';

/** A picture as the game ships one: a resource header, then a whole PNG file. */
function picture(): Buffer {
  const head = Buffer.alloc(16);
  head.writeUInt32LE(16, 0);
  return Buffer.concat([head, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixelsIEND'), Buffer.alloc(4)]);
}

/** A game folder whose pak01 has the arcana's model, picture, eyes and one tinted particle. */
function world(t: TestContext, { withArcana = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-arcana-service-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  const files = [entryAt('scripts/items/items_game.txt', Buffer.from('the game'))];
  if (withArcana) {
    files.push(
      entryAt('models/heroes/terrorblade/terrorblade_arcana.vmdl_c', Buffer.from('the arcana')),
      entryAt('models/heroes/terrorblade/horns_arcana.vmdl_c', Buffer.from('its horns')),
      entryAt('panorama/images/econ/heroes/terrorblade/arcana_terrorblade_png.vtex_c', picture()),
      entryAt(`${ARCANA}/terrorblade_ambient_eyes_arcana_horns.vpcf_c`, host([`${ARCANA}/terrorblade_ambient_eye_arcana_horns.vpcf`])),
      entryAt(`${HERO}/terrorblade_feet_effects.vpcf_c`, particle(encodeKv3({ obj: [['m_ConstantColor', { i32s: [85, 203, 252, 255] }], ['m_Initializers', { arr: [remap(15)] }]] }))),
    );
  }
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk(files));
  const installer = new Installer({ userDataDir: path.join(dir, 'userdata'), getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(path.join(dir, 'userdata'));
  const said: string[] = [];
  const service = createArcanaService({ gamePath: () => game, installer, library, log: (m) => said.push(m) });
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
  assert.equal((pak.read('models/heroes/terrorblade/terrorblade.vmdl_c') as Buffer).toString(), 'the arcana');
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

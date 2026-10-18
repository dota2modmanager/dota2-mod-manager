/* The arcana bases (src/arcana-bases.ts, src/arcana-base-color.ts): which base a set of picks puts
 * on, how its files share the hero with the other picks, and Terrorblade's in a chosen colour.
 *
 * The promise to the user is that a base is the hero's own look and every other item still goes
 * on over it: a weapon picked for Juggernaut is the weapon, on the arcana's body. The base's part
 * for a slot only stands where nothing else was picked for it, or where the pick is the arcana's
 * own part, whose Valve version is what the base fixes. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ARCANA_BASES, chooseBases, hasBase, readyBase, withoutBaseFiles } from '../src/arcana-bases.ts';
import { baseInColor, createColoredBases, materialInColor, particleInColor, windowColor } from '../src/arcana-base-color.ts';
import { constantExpression, constantOf, materialExpressions } from '../src/material.ts';
import { shade, type Rgb } from '../src/recolor.ts';
import { itemNote } from '../src/arcana-notes.ts';
import * as schema from '../src/schema.ts';
import { entryAt, entryPath, readVpkEntryFile } from '../src/vpk.ts';
import { at, encodeKv3, kv3Block, particle, range, remap, resource } from './helpers/kv3-build.ts';
import { readKv3 } from '../src/kv3.ts';
import { dataBlock } from '../src/resource.ts';

const GEM: Rgb = [255, 60, 40];

test('a pick puts on the base of its style, and an item that must be worn with it chooses the variant', () => {
  const ids = (picks: { itemId: string; style: number }[]) => chooseBases(picks).map((b) => b.id);
  assert.deepEqual(ids([{ itemId: '9059', style: 0 }]), ['bladeform_legacy']);
  assert.deepEqual(ids([{ itemId: '9059', style: 1 }]), ['bladeform_legacy_v2']);
  assert.deepEqual(ids([{ itemId: '5957', style: 0 }]), ['fractal_horns_of_inner_abysm'], 'no styles: every style');
  assert.deepEqual(ids([{ itemId: '19090', style: 1 }]), ['dread_retribution_v2']);
  assert.deepEqual(ids([{ itemId: '19090', style: 1 }, { itemId: '6785', style: 0 }]), ['dread_retribution_v2_mask'], "with Mania's Mask, the mask's");
  assert.deepEqual(ids([{ itemId: '19090', style: 0 }, { itemId: '6785', style: 0 }]), ['dread_retribution'], 'the mask has a base under the second style only');
  assert.deepEqual(ids([{ itemId: '9662', style: 0 }]), [], "Spectre's first style works from Valve's files");
  assert.deepEqual(ids([{ itemId: '12451', style: 7 }]), [], "a style of Rubick's the base is not");
  assert.deepEqual(ids([{ itemId: '19089', style: 0 }]), [], 'a part alone is not the arcana');
  assert.deepEqual(ids([{ itemId: '9059', style: 0 }, { itemId: '23095', style: 1 }]), ['bladeform_legacy', 'voidstorm_asylum_v2'], 'one per hero, several heroes');
});

test('every base is a folder of the repository once, its arcana among its parts', () => {
  const seen = new Set<string>();
  for (const b of ARCANA_BASES) {
    assert.ok(!seen.has(b.id), b.id);
    seen.add(b.id);
    assert.ok(b.parts.includes(b.item), `${b.id}: its arcana is one of its parts`);
    for (const r of b.requires || []) assert.ok(b.parts.includes(r), `${b.id}: what it is worn with is its too`);
  }
});

test("an arcana with a base carries no note, and one without keeps the pass's", () => {
  const ARCANA = '"item_rarity"\t\t"arcana"';
  assert.ok(hasBase('23095'));
  assert.equal(itemNote(['razor'], ARCANA, '23095'), null);
  assert.equal(itemNote(['razor'], ARCANA)?.status, 'issues', 'no id, no base: as before');
  assert.equal(itemNote(['nevermore'], ARCANA, '6996'), null);
});

const BODY = 'models/heroes/drow/drow_base.vmdl_c';
const CAPE = 'models/heroes/drow/drow_cape.vmdl_c';
const ready = [readyBase(ARCANA_BASES.find((b) => b.id === 'dread_retribution')!, [
  entryAt(BODY, Buffer.from('fixed body')), entryAt(CAPE, Buffer.from('fixed arcana cape')),
])];

test("the arcana's own part leaves its slot to the base; any other item keeps its files", () => {
  const valveCape = [entryAt(CAPE, Buffer.from("Valve's arcana cape")), entryAt('particles/cape_glow.vpcf_c', Buffer.from('glow'))];
  assert.deepEqual(withoutBaseFiles('19089', valveCape, ready).map(entryPath), ['particles/cape_glow.vpcf_c'], 'Dread Retribution - Cape');
  assert.equal(withoutBaseFiles('7246', valveCape, ready).length, 2, 'another quiver or cape keeps what it writes');
  assert.equal(withoutBaseFiles('19089', valveCape, []).length, 2, 'no base here: as before');
});

function gameTable() {
  const item = (id: string, lines: string[]) => [`\t\t"${id}"`, '\t\t{', ...lines.map((l) => `\t\t\t${l}`), '\t\t}'].join('\n');
  const filler = Array.from({ length: 1000 }, (_, i) => item(String(10000 + i), [`"name"\t\t"Filler ${i}"`, '"prefab"\t\t"wearable"']));
  return ['"items_game"', '{', '\t"items"', '\t{', item('100', ['"name"\t\t"Drow\'s Cape"', '"prefab"\t\t"default_item"']), ...filler, '\t}', '}', ''].join('\n');
}

test('in the built pak another item picked for a slot wins over the base, and the base fills the rest', (t: TestContext) => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-bases-'));
  t.after(() => fs.rmSync(game, { recursive: true, force: true }));
  const text = gameTable();
  const otherCape = entryAt(CAPE, Buffer.from('a cape the user picked'));
  schema.deploy({
    gamePath: game, folder: 'mm', base: { text, stamp: 's' },
    patches: [{ id: '100', block: '"100"\r\n{\r\n\t"name"\t\t"Drow\'s Cape"\r\n\t"prefab"\t\t"default_item"\r\n}', assets: [otherCape] }],
    beneath: ready[0].entries,
  });
  const pak = path.join(game, 'mm', fs.readdirSync(path.join(game, 'mm'))[0]);
  assert.equal(readVpkEntryFile(pak, CAPE)?.data.toString(), 'a cape the user picked');
  assert.equal(readVpkEntryFile(pak, BODY)?.data.toString(), 'fixed body');
});

test("a colour moved from the one a file was made in: the base's own colour stays, another follows", () => {
  assert.deepEqual(shade([200, 50, 30], GEM, GEM), [200, 50, 30]);
  const blue = shade([200, 50, 30], [40, 120, 255], GEM);
  assert.ok(blue[2] > blue[0] && blue[2] > blue[1], `blue, not ${blue}`);
  assert.deepEqual(shade([128, 128, 128], [40, 120, 255], GEM), [128, 128, 128], 'grey has no hue to move');
});

/** A KV3 material whose tint is a constant, as the Workshop Tools compile a colour typed in. */
const material = (code: Buffer) => resource([
  ['RERL', Buffer.from('references')],
  ['DATA', encodeKv3({ obj: [
    ['m_materialName', { str: 'materials/test.vmat' }],
    ['m_dynamicParams', { arr: [{ obj: [['m_name', { str: 'g_vDetail1ColorTint' }], ['m_value', { blob: code }]] }] }],
  ] })],
]);

test("a base's material with the gem's colour typed in takes the chosen one, and another constant stays", () => {
  // what J0nathan550's Terrorblade has: 0.235 and 0.157 for 60/255 and 40/255
  const typed = constantExpression([1, 0.235, 0.157]);
  assert.equal(typed.toString('hex'), '070000803f07d7a3703e079cc4203e06190000', 'the bytes in the base, to the byte');
  assert.deepEqual(constantOf(typed)!.map((n) => +n.toFixed(3)), [1, 0.235, 0.157]);
  assert.equal(constantOf(Buffer.from([0x19, 1, 2, 3, 4, 0])), null, 'a read is not a constant');
  const r = materialInColor(material(typed), [0, 255, 0], GEM);
  assert.equal(r.changed, 1);
  assert.deepEqual(constantOf(materialExpressions(r.file)[0].code), [0, 1, 0]);
  assert.equal(materialInColor(material(constantExpression([0.35, 0.74, 1])), [0, 255, 0], GEM).changed, 0, 'not the gem');
});

test("a base in a colour: its particles and materials move, other files and the base's own colour do not", () => {
  const entries = [
    entryAt('particles/units/heroes/hero_terrorblade/glow.vpcf_c', particle(kv3Block([255, 60, 40, 255]))),
    entryAt('materials/models/heroes/terrorblade/body.vmat_c', material(constantExpression([1, 0.235, 0.157]))),
    entryAt('models/heroes/terrorblade/terrorblade.vmdl_c', Buffer.from('a model')),
  ];
  const blue = baseInColor(entries, [40, 120, 255], GEM);
  assert.equal(blue.changed, 2);
  assert.deepEqual(blue.failed, []);
  assert.equal(blue.entries[2], entries[2], 'a model is no colour');
  assert.equal(baseInColor(entries, GEM, GEM).entries, entries, 'red is the base as it was made');
  const broken = baseInColor([entryAt('particles/x.vpcf_c', Buffer.from('not a particle'))], [40, 120, 255], GEM);
  assert.deepEqual(broken.failed, ['particles/x.vpcf_c'], 'counted, and kept as it is');
});

test("a base's particle that puts the gem on control point 15 itself has the chosen colour there", () => {
  // the shape of 94 of the base's 120: the gem and the tint's switch set before emission, a tint
  // that reads the point, and the gem's red written in as well
  const point = (cp: number, pos: number[]) => ({ obj: [['_class', { str: 'C_OP_SetSingleControlPointPosition' }], ['m_nCP1', { int: cp }], ['m_vecCP1Pos', { f64s: pos }]] as [string, never][] });
  const file = particle(encodeKv3({ obj: [
    ['m_ConstantColor', { i32s: [255, 60, 40, 255] }],
    ['m_PreEmissionOperators', { arr: [point(15, [255, 60, 40]), point(16, [1, 0, 0])] }],
    ['m_Initializers', { arr: [remap(15)] }],
  ] }));
  const purple: Rgb = [150, 40, 255];
  const r = particleInColor(file, purple, GEM);
  const kv = readKv3(dataBlock(r.file).data);
  assert.deepEqual(range(kv, at(kv.root, 'm_PreEmissionOperators', 0, 'm_vecCP1Pos')), purple, 'the gem is the chosen colour: it was red under the purple');
  assert.deepEqual(range(kv, at(kv.root, 'm_PreEmissionOperators', 1, 'm_vecCP1Pos')), [1, 0, 0], 'the tint stays on');
  assert.deepEqual(range(kv, at(kv.root, 'm_Initializers', 0, 'm_vOutputMax')), [1, 1, 1], 'not baked: the tint reads the point');
  assert.deepEqual(range(kv, at(kv.root, 'm_ConstantColor')).slice(0, 3), shade([255, 60, 40], purple, GEM), 'the written red moves too');
  assert.equal(particleInColor(file, GEM, GEM).file.equals(file), true, 'red is the base as it was made');
});

test("the builder's Terrorblade base is in the arcana window's colour while the window's record is on", () => {
  const blue: Rgb = [40, 120, 255];
  const win = (enabled: boolean, color: unknown = blue) => ({ enabled, generated: { set: 'terrorblade-arcana', color, mode: 'mod' } });
  assert.deepEqual(windowColor([{ enabled: true }, win(true)]), blue);
  assert.equal(windowColor([win(false)]), null, 'switched off: the base as it was made');
  assert.equal(windowColor([]), null, 'no record: the same');
  assert.equal(windowColor([win(true, [1, 2])]), null, 'not a colour');

  const glow = 'particles/units/heroes/hero_terrorblade/glow.vpcf_c';
  const tb = ARCANA_BASES.find((b) => b.id === 'fractal_horns_of_inner_abysm')!;
  const jugg = ARCANA_BASES.find((b) => b.id === 'bladeform_legacy')!;
  const files = () => [entryAt(glow, particle(kv3Block([255, 60, 40, 255])))];
  const colored = createColoredBases();
  const [t, j] = colored([readyBase(tb, files()), readyBase(jugg, files())], blue);
  assert.notDeepEqual(t.entries[0].data, files()[0].data, "Terrorblade's moves");
  assert.deepEqual(t.paths, new Set([glow]), 'at the same paths, so every other pick still wins over it');
  assert.deepEqual(j.entries[0].data, files()[0].data, 'no other base has a window');
  assert.equal(colored([readyBase(tb, files())], blue)[0].entries, t.entries, 'the same files in the same colour: made once');
  const asMade = readyBase(tb, files());
  assert.equal(colored([asMade], null)[0], asMade, 'no colour: untouched');
});

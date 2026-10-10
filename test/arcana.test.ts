/* An arcana as a mod (src/arcana.ts) and what it is built with: a KV3 block written anew from its
 * tree (src/kv3-write.ts), the resources a file names (src/resource.ts), and colours written into
 * the files for a hero who has no gem (src/recolor.ts, `bake`), issue #118.
 *
 * On 2026-10-09 the writer read and wrote back 3829 particles and materials of four heroes with
 * the same tree, its object and array counts equal to Valve's in all 3106 of versions 2 to 4, and
 * resourceId() gave the id of every one of the 1304 references in Terrorblade's files. These tests
 * hold the parts that run without the game, on files built by test/helpers/kv3-build.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readKv3, readCell, numberOf, type Kv3Block, type Kv3Node } from '../src/kv3.ts';
import { writeKv3 } from '../src/kv3-write.ts';
import { dataBlock, references, resourceBlock, resourceBlocks, resourceId, withReferences } from '../src/resource.ts';
import { recolorResource, type Rgb } from '../src/recolor.ts';
import { buildArcana, withChildren } from '../src/arcana.ts';
import { materialExpressions } from '../src/material.ts';
import { buildVpk, entryAt, openVpkIndex } from '../src/vpk.ts';
import { at, encodeKv3, host, particle, remap, resource, rerl, type V } from './helpers/kv3-build.ts';

/** A tree as plain data, every number as the bytes it is stored in, to compare two blocks by. */
function plain(kv: Kv3Block, n: Kv3Node): unknown {
  const f = n.flag ? { f: n.flag } : {};
  switch (n.kind) {
    case 'number': return { ...f, t: n.type, b: n.cell ? kv.buffers[n.cell.buffer].subarray(n.cell.offset, n.cell.offset + n.cell.width).toString('hex') : null };
    case 'string': return { ...f, s: n.value };
    case 'blob': return { ...f, x: n.data.toString('hex') };
    case 'other': return { ...f, o: n.type, v: n.value };
    case 'array': return { ...f, e: n.items.length ? n.element : undefined, a: n.items.map((x) => plain(kv, x)) };
    case 'object': return { ...f, m: [...n.members].map(([k, v]) => [k, plain(kv, v)]) };
  }
}

/** Every kind of value the writer has to carry. */
const EVERYTHING: V = { obj: [
  ['_class', { str: 'C_INIT_RemapCPtoVector' }],
  ['m_ChildRef', { ref: 'particles/a.vpcf' }],
  ['m_empty', { str: '' }],
  ['m_bOn', { bool: true }],
  ['m_bAlways', { yes: true }],
  ['m_nCount', { int: -7 }],
  ['m_nSeed', { i64: 9007199254740993 }],
  ['m_flOne', { one: true }],
  ['m_flScale', { dbl: 0.1 }],
  ['m_nZero', { i64zero: true }],
  ['m_Color', { i32s: [255, 60, 40, 255] }],
  ['m_vRange', { f64s: [1, 1.2, 2] }],
  ['m_code', { blob: Buffer.from('an expression') }],
  ['m_list', { arr: [{ obj: [['m_name', { str: 'x' }]] }, { int: 3 }, { arr: [] }] }],
] };

for (const version of [1, 2] as const) {
  test(`a version ${version} block written anew from its tree reads back the same, flags included`, () => {
    const kv = readKv3(encodeKv3(EVERYTHING, version));
    const out = writeKv3(kv);
    const back = readKv3(out);
    assert.equal(back.version, 2, 'versions 1 and 2 come out as 2');
    assert.deepEqual(plain(back, back.root), plain(kv, kv.root));
    assert.equal((at(back.root, 'm_ChildRef') as { flag?: number }).flag, 1, 'still names a resource');
  });
}

test('a written block carries an element added to an array, and an empty typed array as a plain one', () => {
  const kv = readKv3(encodeKv3({ obj: [['m_Children', { arr: [{ obj: [['m_ChildRef', { ref: 'particles/a.vpcf' }]] }] }], ['m_none', { i32s: [] }]] }));
  const list = at(kv.root, 'm_Children') as Extract<Kv3Node, { kind: 'array' }>;
  list.items.push({ kind: 'object', members: new Map([['m_ChildRef', { kind: 'string', value: 'particles/b.vpcf', flag: 1 }]]) } as Kv3Node);
  const back = readKv3(writeKv3(kv));
  assert.deepEqual((at(back.root, 'm_Children') as Extract<Kv3Node, { kind: 'array' }>).items.map((x) => (at(x, 'm_ChildRef') as { value: string }).value),
    ['particles/a.vpcf', 'particles/b.vpcf']);
  assert.equal((at(back.root, 'm_none') as Extract<Kv3Node, { kind: 'array' }>).element, undefined);
});

test('a resource is named in RERL by the id the game gives it', () => {
  // read out of the game's terrorblade_ambient_eyes.vpcf_c
  assert.equal(resourceId('particles/units/heroes/hero_terrorblade/terrorblade_ambient_eye.vpcf'), 0xecab88b177c7aabcn);
});

test('a resource named in RERL is added once, with its id, and the blocks after move and stay aligned', () => {
  const data = encodeKv3({ obj: [['m_nCount', { int: 7 }]] });
  const file = resource([['RERL', rerl(['particles/a.vpcf'])], ['DATA', data]]);
  const next = withReferences(file, ['particles/a.vpcf', 'particles/a_much_longer_name_than_before.vpcf']);
  assert.deepEqual(references(next), ['particles/a.vpcf', 'particles/a_much_longer_name_than_before.vpcf']);
  const table = resourceBlock(next, 'RERL').data;
  assert.equal(table.readBigUInt64LE(8 + 16), resourceId('particles/a_much_longer_name_than_before.vpcf'));
  assert.deepEqual(dataBlock(next).data, data);
  for (const b of resourceBlocks(next)) assert.equal(b.at % 16, 0, `${b.name} stays aligned`);
  assert.equal(next.readUInt32LE(0), next.length);
  assert.deepEqual(references(resource([['DATA', data]])), [], 'a file with no RERL names nothing');
});

test('a particle is given another child, copied from its first, and names it in RERL', () => {
  const next = withChildren(host(), [{ path: 'particles/body.vpcf' }]);
  const kv = readKv3(dataBlock(next).data);
  const items = (at(kv.root, 'm_Children') as Extract<Kv3Node, { kind: 'array' }>).items;
  assert.deepEqual(items.map((x) => (at(x, 'm_ChildRef') as { value: string }).value), ['particles/eye.vpcf', 'particles/body.vpcf']);
  assert.equal((at(items[1], 'm_ChildRef') as { flag?: number }).flag, 1);
  assert.equal(readCell(kv, (at(items[1], 'm_flDelay') as { cell: NonNullable<Parameters<typeof readCell>[1]> }).cell), 0.5);
  assert.deepEqual(references(next), ['particles/eye.vpcf', 'particles/body.vpcf']);
  assert.throws(() => withChildren(particle(encodeKv3({ obj: [['m_nCount', { int: 1 }]] })), [{ path: 'particles/body.vpcf' }]), /no children/);
});

test("a child hung on with an attachment gets a control point of its own there, not at its parent's first", () => {
  // the arcana's body glow on the eyes was drawn at the right eye until it had one
  const next = withChildren(host(['particles/eye.vpcf', 'particles/eye.vpcf']), [{ path: 'particles/body.vpcf', attachment: 'attach_hitloc' }]);
  const kv = readKv3(dataBlock(next).data);
  const config = at(kv.root, 'm_controlPointConfigurations', 0, 'm_drivers') as Extract<Kv3Node, { kind: 'array' }>;
  assert.equal(config.items.length, 3);
  const driver = config.items[2];
  assert.equal(numberOf(kv, at(driver, 'm_iControlPoint') as Extract<Kv3Node, { kind: 'number' }>), 2);
  assert.equal((at(driver, 'm_attachmentName') as { value: string }).value, 'attach_hitloc');
  assert.equal((at(driver, 'm_entityName') as { value: string }).value, 'parent', 'bound the way its siblings are');
  assert.equal(numberOf(kv, at(kv.root, 'm_PreEmissionOperators', 0, 'm_nNumControlPoints') as Extract<Kv3Node, { kind: 'number' }>), 3);
  const loose = particle(encodeKv3({ obj: [['m_Children', { arr: [{ obj: [['m_ChildRef', { ref: 'particles/eye.vpcf' }]] }] }]] }));
  assert.throws(() => withChildren(loose, [{ path: 'particles/body.vpcf', attachment: 'attach_hitloc' }]), /one by one/);
});

const GEM: Rgb = [255, 60, 40];
const T: Rgb = [100, 50, 20];

test('with no gem, a particle the gem would tint starts from the colour the tint would have given', () => {
  const colors = (file: Buffer) => {
    const kv = readKv3(dataBlock(file).data);
    return Object.fromEntries(kv.arrays.map((a) => [a.key, a.cells.slice(0, 3).map((c) => readCell(kv, c!))]));
  };
  const replaced = recolorResource(particle(encodeKv3({ obj: [
    ['m_ConstantColor', { i32s: [0, 210, 255, 255] }],
    ['m_ColorFade', { i32s: [0, 105, 128, 255] }],
    ['m_Initializers', { arr: [remap(15, [1, 1, 1])] }],
  ] })), T, { bake: true, own: false });
  assert.deepEqual(colors(replaced.file).m_ConstantColor, T, 'what the tint replaces it with');
  const [r, g, b] = colors(replaced.file).m_ColorFade;
  assert.ok(r > g && g > b, `the fade takes the chosen hue, not ${[r, g, b]}`);
  const scaled = encodeKv3({ obj: [
    ['m_ConstantColor', { i32s: [255, 128, 0, 255] }],
    ['m_Initializers', { arr: [{ obj: [...(remap(15, [2, 2, 2]) as { obj: [string, V][] }).obj, ['m_nSetMethod', { str: 'PARTICLE_SET_SCALE_INITIAL_VALUE' }]] }] }],
  ] });
  assert.deepEqual(colors(recolorResource(particle(scaled), T, { bake: true }).file).m_ConstantColor, [200, 50, 0], 'a scaling tint: the colour times the chosen one, times its range');
  assert.equal(recolorResource(particle(encodeKv3({ obj: [['m_ConstantColor', { i32s: [0, 210, 255, 255] }]] })), T, { bake: true, own: false }).changed, 0,
    'a shared particle with no tint is left as it is');
});

test('the arcana becomes one VPK: its models and pictures under the plain names, its glow hung on the eyes, its colour written in', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-arcana-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const arcana = 'particles/econ/items/terrorblade/terrorblade_horns_arcana';
  const hero = 'particles/units/heroes/hero_terrorblade';
  const tint = Buffer.from('1fe6164651040a0012001fe6164651022400073333b33e073333333f070000803f06190000', 'hex');
  tint[10] = 0x19; // the read of $GemColor, after the check that it exists
  const material = resource([['RERL', rerl([])], ['DATA', encodeKv3({ obj: [
    ['m_dynamicParams', { arr: [{ obj: [['m_name', { str: 'g_vDetail1ColorTint' }], ['m_value', { blob: tint }]] }] }],
  ] })]]);
  const pak01 = path.join(dir, 'pak01_dir.vpk');
  fs.writeFileSync(pak01, buildVpk([
    entryAt('models/heroes/terrorblade/terrorblade_arcana.vmdl_c', Buffer.from('the arcana')),
    entryAt('models/heroes/terrorblade/horns_arcana.vmdl_c', Buffer.from('its horns')),
    entryAt('models/heroes/terrorblade/terrorblade.vmdl_c', Buffer.from('the plain hero')),
    entryAt('panorama/images/heroes/npc_dota_hero_terrorblade_alt1_png.vtex_c', Buffer.from('arcana portrait')),
    entryAt('panorama/images/heroes/npc_dota_hero_terrorblade_png.vtex_c', Buffer.from('plain portrait')),
    entryAt('panorama/images/spellicons/terrorblade_unused_alt1_png.vtex_c', Buffer.from('no plain one to replace')),
    entryAt(`${arcana}/terrorblade_ambient_eyes_arcana_horns.vpcf_c`, host([`${arcana}/terrorblade_ambient_eye_arcana_horns.vpcf`])),
    entryAt(`${hero}/terrorblade_ambient_eyes.vpcf_c`, host()),
    entryAt(`${hero}/terrorblade_feet_effects.vpcf_c`, particle(encodeKv3({ obj: [['m_ConstantColor', { i32s: [85, 203, 252, 255] }], ['m_Initializers', { arr: [remap(15)] }]] }))),
    entryAt('materials/models/heroes/terrorblade/terrorblade_arcana_color.vmat_c', material),
  ]));
  const out = buildArcana({ pak01, set: 'terrorblade-arcana', target: GEM });
  const mod = path.join(dir, 'mod_dir.vpk');
  fs.writeFileSync(mod, out.vpk);
  const read = (p: string) => openVpkIndex(mod).read(p) as Buffer;
  assert.equal(read('models/heroes/terrorblade/terrorblade.vmdl_c').toString(), 'the arcana');
  assert.equal(read('models/heroes/terrorblade/horns.vmdl_c').toString(), 'its horns');
  assert.equal(read('panorama/images/heroes/npc_dota_hero_terrorblade_png.vtex_c').toString(), 'arcana portrait');
  assert.ok(!read('panorama/images/spellicons/terrorblade_unused_png.vtex_c'), 'an icon with no plain one is not made up');
  const eyes = read(`${hero}/terrorblade_ambient_eyes.vpcf_c`);
  assert.deepEqual(references(eyes), [`${arcana}/terrorblade_ambient_eye_arcana_horns.vpcf`, `${arcana}/terrorblade_ambient_body_arcana_horns.vpcf`]);
  const drivers = at(readKv3(dataBlock(eyes).data).root, 'm_controlPointConfigurations', 0, 'm_drivers') as Extract<Kv3Node, { kind: 'array' }>;
  assert.equal((at(drivers.items[1], 'm_attachmentName') as { value: string }).value, 'attach_hitloc', 'the glow of the body on the chest');
  const feet = readKv3(dataBlock(read(`${hero}/terrorblade_feet_effects.vpcf_c`)).data);
  assert.deepEqual(feet.arrays.find((a) => a.key === 'm_ConstantColor')!.cells.slice(0, 3).map((c) => readCell(feet, c!)), GEM, 'the gem\'s colour, written in');
  const [expression] = materialExpressions(read('materials/models/heroes/terrorblade/terrorblade_arcana_color.vmat_c'));
  assert.equal(expression.code.length, 19, 'one colour, whatever the gem: three numbers, a call and the end');
  assert.equal(expression.code.readFloatLE(1), 1);
  assert.equal(numberOf(feet, at(feet.root, 'm_Initializers', 0, 'm_nCPInput') as Extract<Kv3Node, { kind: 'number' }>), 15, 'the tint itself stays');
  assert.throws(() => buildArcana({ pak01, set: 'nobody', target: GEM }), /no set/);
});

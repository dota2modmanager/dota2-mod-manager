/* Recolouring compiled particles (src/kv3.ts, src/recolor.ts), issue #118.
 *
 * Valve's own particles cannot be committed here, so the tests build one: a binary KV3 version 2
 * block with the shapes the real ones have (a colour as a typed array of INT32s, a colour whose
 * zero has no bytes of its own, an integer and a switch beside them), inside a resource with its
 * DATA block last. On 2026-10-08 the same code recoloured 226 of the game's 342 Terrorblade
 * particles, versions 2 to 5, and Source 2 Viewer read every one back with only the colours
 * changed; these hold the parts that run without the game.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { lz4Decode, lz4Literals, readKv3, readCell, numberOf, setNumber, type Kv3Node } from '../src/kv3.ts';
import { buildRecolor, dataBlock, recolorResource, recolorTexture, rotateHue, shade, type Rgb } from '../src/recolor.ts';
import { buildVpk, entryAt, openVpkIndex } from '../src/vpk.ts';

/** A value as the test writes it, one key per KV3 type the encoder below knows. */
type V = { int: number } | { i32s: number[] } | { str: string } | { yes: true } | { one: true } | { dbl: number }
  | { i64: number } | { i64zero: true } | { f64s: number[] } | { obj: [string, V][] } | { arr: V[] };

/** KV3 version 2, one buffer, LZ4: the shape 290 of the game's Terrorblade particles have. */
function encodeKv3(root: V): Buffer {
  const strings: string[] = [];
  const sid = (x: string) => { let i = strings.indexOf(x); if (i < 0) { i = strings.length; strings.push(x); } return i; };
  const l4: number[] = [];
  const l8: [number, boolean][] = []; // value, and whether it is a double
  const types: number[] = [];
  const typeOf = (v: V): number => ('int' in v ? 11 : 'i32s' in v ? 10 : 'str' in v ? 6 : 'yes' in v ? 13 : 'one' in v ? 18 : 'dbl' in v ? 5
    : 'i64' in v ? 3 : 'i64zero' in v ? 15 : 'f64s' in v ? 10 : 'obj' in v ? 9 : 8);
  const body = (v: V): void => {
    if ('int' in v) l4.push(v.int);
    else if ('i32s' in v) { l4.push(v.i32s.length); types.push(11); l4.push(...v.i32s); }
    else if ('f64s' in v) { l4.push(v.f64s.length); types.push(5); l8.push(...v.f64s.map((x): [number, boolean] => [x, true])); }
    else if ('str' in v) l4.push(sid(v.str));
    else if ('dbl' in v) l8.push([v.dbl, true]);
    else if ('i64' in v) l8.push([v.i64, false]);
    else if ('obj' in v) { l4.push(v.obj.length); for (const [k, x] of v.obj) { types.push(typeOf(x)); l4.push(sid(k)); body(x); } }
    else if ('arr' in v) { l4.push(v.arr.length); for (const x of v.arr) { types.push(typeOf(x)); body(x); } }
  };
  types.push(typeOf(root));
  body(root);
  const ints = [strings.length, ...l4];
  const b4 = Buffer.alloc(ints.length * 4);
  ints.forEach((n, i) => b4.writeInt32LE(n, i * 4));
  const b8 = Buffer.alloc(l8.length * 8);
  l8.forEach(([n, dbl], i) => (dbl ? b8.writeDoubleLE(n, i * 8) : b8.writeBigInt64LE(BigInt(n), i * 8)));
  const text = Buffer.from(strings.map((x) => `${x}\0`).join(''));
  const pad = Buffer.alloc((8 - (b4.length % 8)) % 8);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32LE(0xffeedd00);
  const raw = Buffer.concat([b4, pad, b8, text, Buffer.from(types), trailer]);
  const packed = lz4Literals(raw);
  const head = Buffer.alloc(64);
  head.writeUInt32LE(0x4b563302, 0);
  head.writeUInt32LE(1, 20); // LZ4
  head.writeUInt16LE(16384, 26);
  head.writeInt32LE(0, 28); head.writeInt32LE(ints.length, 32); head.writeInt32LE(l8.length, 36);
  head.writeInt32LE(text.length + types.length, 40);
  head.writeInt32LE(raw.length, 48); head.writeInt32LE(packed.length, 52);
  return Buffer.concat([head, packed]);
}

/** A particle: a colour, an integer and a switch beside it, and a colour whose zero has no bytes. */
function kv3Block(color: number[] = [0, 210, 255, 255]): Buffer {
  return encodeKv3({ obj: [
    ['m_ConstantColor', { i32s: color }],
    ['m_nMaxParticles', { int: 500 }],
    ['m_bSaturateColorPreAlphaBlend', { yes: true }],
    ['m_ColorMin', { arr: [{ i64zero: true }, { i64: 210 }, { i64: 255 }] }],
  ] });
}

/** An operator that takes the colour from a control point, as strong as `strength` says. */
const remap = (cp: number, strength: V): V => ({ obj: [
  ['_class', { str: 'C_INIT_RemapCPtoVector' }],
  ['m_nCPInput', { int: cp }],
  ['m_nFieldOutput', { int: 6 }],
  ['m_flOpStrength', { obj: [['m_nType', { str: 'PF_TYPE_CONTROL_POINT_COMPONENT' }], ['m_flOutput1', strength]] }],
] });

/** A compiled resource: one RERL block, then DATA. */
function resource(data: Buffer): Buffer {
  const rerl = Buffer.from('references');
  const head = Buffer.alloc(16 + 24);
  head.writeUInt16LE(12, 4);
  head.writeUInt32LE(8, 8);
  head.writeUInt32LE(2, 12);
  head.write('RERL', 16, 'ascii'); head.writeUInt32LE(40 - 20, 20); head.writeUInt32LE(rerl.length, 24);
  head.write('DATA', 28, 'ascii'); head.writeUInt32LE(40 + rerl.length - 32, 32); head.writeUInt32LE(data.length, 36);
  const out = Buffer.concat([head, rerl, data]);
  out.writeUInt32LE(out.length, 0);
  return out;
}

const PINK: Rgb = [255, 193, 220];

test('LZ4: literals round-trip, and a back-reference repeats what came before', () => {
  const text = Buffer.from('a block long enough to need a second length byte, and then some more');
  assert.deepEqual(lz4Decode(lz4Literals(text), text.length), text);
  assert.equal(lz4Decode(Buffer.from([0x35, 0x61, 0x62, 0x63, 3, 0]), 12).toString(), 'abcabcabcabc');
  assert.throws(() => lz4Decode(Buffer.from([0x35, 0x61, 0x62, 0x63, 9, 0]), 12), /outside the output/);
});

test('the walk finds every array and where each number lies, and a zero with no bytes as a gap', () => {
  const kv = readKv3(kv3Block());
  assert.equal(kv.version, 2);
  const color = kv.arrays.find((a) => a.key === 'm_ConstantColor')!;
  assert.deepEqual(color.cells.map((c) => readCell(kv, c!)), [0, 210, 255, 255]);
  const min = kv.arrays.find((a) => a.key === 'm_ColorMin')!;
  assert.equal(min.cells[0], null);
  assert.deepEqual(min.cells.slice(1).map((c) => readCell(kv, c!)), [210, 255]);
});

test('a block the walk cannot account for to the last byte is refused', () => {
  const broken = kv3Block();
  broken.writeInt32LE(14, 32); // one more int than the block holds
  assert.throws(() => readKv3(broken));
  assert.throws(() => readKv3(Buffer.from('not kv3 at all, just text, long enough')), /not a binary KV3/);
});

test('the main colour becomes the chosen one, a darker one a darker shade of it, and greys stay', () => {
  assert.deepEqual(shade([0, 210, 255], PINK), PINK);
  const [r, g, b] = shade([31, 89, 88], PINK);
  assert.ok(r > g && r > b && r < 120, `a dark teal becomes a dark pink, not ${[r, g, b]}`);
  assert.deepEqual(shade([128, 128, 128], PINK), [128, 128, 128]);
  assert.deepEqual(shade([0, 0, 0], PINK), [0, 0, 0]);
});

test('a resource is recoloured in place, and a colour with no room for a channel is left whole', () => {
  const before = resource(kv3Block());
  const r = recolorResource(before, PINK);
  assert.equal(r.changed, 1);
  assert.equal(r.skipped, 1, 'm_ColorMin keeps its zero');
  const kv = readKv3(dataBlock(r.file).data);
  const get = (key: string) => kv.arrays.find((a) => a.key === key)!.cells.map((c) => (c ? readCell(kv, c) : 0));
  assert.deepEqual(get('m_ConstantColor'), [...PINK, 255]);
  assert.deepEqual(get('m_ColorMin'), [0, 210, 255], 'untouched');
  assert.equal(r.file.readUInt32LE(0), r.file.length, 'the file size in the header follows the new block');
  assert.deepEqual(dataBlock(r.file).data.subarray(0, 4), dataBlock(before).data.subarray(0, 4));
});

/** A member of an object node, by a path of names and array indexes. */
function at(node: Kv3Node, ...path: (string | number)[]): Kv3Node {
  let n = node;
  for (const k of path) n = typeof k === 'number' ? (n as Extract<Kv3Node, { kind: 'array' }>).items[k] : (n as Extract<Kv3Node, { kind: 'object' }>).members.get(k)!;
  return n;
}

test('the tint the game adds through control point 15 is turned off, whatever way its strength is written', () => {
  // the arcana showed red in the game with its particles saying cyan: the game paints them through CP 15
  const block = encodeKv3({ obj: [
    ['m_ConstantColor', { i32s: [0, 210, 255, 255] }],
    ['m_Initializers', { arr: [remap(15, { one: true }), remap(15, { dbl: 1 }), remap(3, { one: true })] }],
  ] });
  const r = recolorResource(resource(block), PINK);
  assert.equal(r.changed, 3, 'the colour and two tints');
  const kv = readKv3(dataBlock(r.file).data);
  const strength = (i: number) => numberOf(kv, at(kv.root, 'm_Initializers', i, 'm_flOpStrength', 'm_flOutput1') as Extract<Kv3Node, { kind: 'number' }>);
  assert.equal(strength(0), 0, 'a 1.0 written as its type alone');
  assert.equal(strength(1), 0, 'a 1.0 written as a double');
  assert.equal(strength(2), 1, 'a remap from another control point is not the tint the game adds');
});

test('a number stored as its type alone can only become the other of 0 and 1', () => {
  const kv = readKv3(encodeKv3({ obj: [['a', { one: true }]] }));
  const a = at(kv.root, 'a') as Extract<Kv3Node, { kind: 'number' }>;
  assert.equal(setNumber(kv, a, 0.5), false);
  assert.equal(setNumber(kv, a, 0), true);
  assert.equal(numberOf(kv, at(readKv3(kv.encode()).root, 'a') as Extract<Kv3Node, { kind: 'number' }>), 0, 'and it survives being written back');
});

test('a scale with Color in its name is not taken for a colour', () => {
  const r = recolorResource(resource(encodeKv3({ obj: [['m_vecTailColorScale', { f64s: [1.5, 1.5, 1.5] }]] })), PINK);
  assert.equal(r.changed, 0);
});

test('a colour table is turned round the colour wheel, its greys kept, and other textures left alone', () => {
  // 2 x 1 x 1, RGBA8888, one mip, pixels right after the DATA block
  const header = Buffer.alloc(40);
  header.writeUInt16LE(2, 20); header.writeUInt16LE(1, 22); header.writeUInt16LE(1, 24);
  header[26] = 4; header[27] = 1;
  const lut = (format: number) => { const h = Buffer.from(header); h[26] = format; return Buffer.concat([resource(h), Buffer.from([255, 0, 0, 255, 128, 128, 128, 255])]); };
  const r = recolorTexture(lut(4), 120);
  assert.equal(r.changed, 1);
  assert.deepEqual([...r.file.subarray(-8)], [0, 255, 0, 255, 128, 128, 128, 255]);
  assert.equal(recolorTexture(lut(2), 120).changed, 0, 'a block-compressed texture is not read as pixels');
  assert.deepEqual(rotateHue([255, 0, 0], 334), [255, 0, 111]);
});

test('a file with nothing to recolour comes back as it was', () => {
  const grey = resource(kv3Block([90, 90, 90, 255]));
  const r = recolorResource(grey, PINK);
  assert.equal(r.changed, 0);
  assert.equal(r.file, grey);
});

test('a colour is read as three numbers or a hex code, and nothing else', async () => {
  const { parseColor } = await import('../tools/recolor.mjs');
  assert.deepEqual(parseColor('255,193,220'), [255, 193, 220]);
  assert.deepEqual(parseColor('#FFC1DC'), [255, 193, 220]);
  assert.deepEqual(parseColor('ffc1dc'), [255, 193, 220]);
  for (const bad of ['256,0,0', '1,2', 'pink', '', null]) assert.equal(parseColor(bad), null, String(bad));
});

test('a set becomes one VPK of the files that took the colour, from the game\'s own pak01', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-recolor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pak01 = path.join(dir, 'pak01_dir.vpk');
  const folder = 'particles/econ/items/terrorblade/terrorblade_horns_arcana';
  fs.writeFileSync(pak01, buildVpk([
    entryAt(`${folder}/glow.vpcf_c`, resource(kv3Block())),
    entryAt(`${folder}/smoke.vpcf_c`, resource(kv3Block([90, 90, 90, 255]))),
    entryAt(`${folder}/broken.vpcf_c`, Buffer.from('not a resource, not long enough either')),
    entryAt('particles/units/heroes/hero_axe/axe_attack.vpcf_c', resource(kv3Block())),
  ]));
  const out = buildRecolor({ pak01, set: 'terrorblade-arcana', target: PINK });
  assert.equal(out.files, 1, 'the grey one took nothing, and Axe is not in the set');
  assert.equal(out.failed.length, 1);
  assert.match(out.failed[0].path, /broken/);
  const mod = path.join(dir, 'mod_dir.vpk');
  fs.writeFileSync(mod, out.vpk);
  const kv = readKv3(dataBlock(openVpkIndex(mod).read(`${folder}/glow.vpcf_c`) as Buffer).data);
  assert.deepEqual(kv.arrays[0].cells.map((c) => readCell(kv, c!)), [...PINK, 255]);
  assert.throws(() => buildRecolor({ pak01, set: 'nobody', target: PINK }), /no set/);
});

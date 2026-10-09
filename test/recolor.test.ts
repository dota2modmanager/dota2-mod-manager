/* Recolouring compiled particles and materials (src/kv3.ts, src/material.ts, src/recolor.ts), issue #118.
 *
 * Valve's own files cannot be committed here, so the tests build them: binary KV3 blocks of
 * versions 1 and 2 with the shapes the real ones have (a colour as a typed array of INT32s, a
 * colour whose zero has no bytes of its own, a range of doubles, a binary blob), a material in the
 * older NTRO container, and resources with their blocks in the order the game writes them. On
 * 2026-10-09 the same code read and wrote back 3829 particles and materials of four heroes,
 * versions 1 to 5, 193 of them with blobs; these hold the parts that run without the game.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readKv3, readCell, numberOf, setNumber, type Kv3Node } from '../src/kv3.ts';
import { lz4Decode, lz4Literals } from '../src/lz4.ts';
import { attributeToken, dataBlock, materialExpressions, resourceBlocks, withConstant } from '../src/material.ts';
import { buildRecolor, recolorMaterial, recolorResource, shade, type Rgb } from '../src/recolor.ts';
import { buildVpk, entryAt, openVpkIndex } from '../src/vpk.ts';

/** A value as the test writes it, one key per KV3 type the encoder below knows. */
type V = { int: number } | { i32s: number[] } | { str: string } | { yes: true } | { one: true } | { dbl: number }
  | { i64: number } | { i64zero: true } | { f64s: number[] } | { blob: Buffer } | { obj: [string, V][] } | { arr: V[] };

const TRAILER = 0xffeedd00;
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const pad = (n: number, a: number) => Buffer.alloc((a - (n % a)) % a);

/**
 * A binary KV3 block, LZ4. Version 2 is the shape 290 of the game's Terrorblade particles have,
 * blobs in frames after the buffer; version 1 keeps a blob in the 1-byte lane.
 */
function encodeKv3(root: V, version: 1 | 2 = 2): Buffer {
  const strings: string[] = [];
  const sid = (x: string) => { let i = strings.indexOf(x); if (i < 0) { i = strings.length; strings.push(x); } return i; };
  const l1: Buffer[] = [];
  const l4: number[] = [];
  const l8: [number, boolean][] = []; // value, and whether it is a double
  const types: number[] = [];
  const blobs: Buffer[] = [];
  const typeOf = (v: V): number => ('int' in v ? 11 : 'i32s' in v ? 10 : 'str' in v ? 6 : 'yes' in v ? 13 : 'one' in v ? 18 : 'dbl' in v ? 5
    : 'i64' in v ? 3 : 'i64zero' in v ? 15 : 'f64s' in v ? 10 : 'blob' in v ? 7 : 'obj' in v ? 9 : 8);
  const body = (v: V): void => {
    if ('int' in v) l4.push(v.int);
    else if ('i32s' in v) { l4.push(v.i32s.length); types.push(11); l4.push(...v.i32s); }
    else if ('f64s' in v) { l4.push(v.f64s.length); types.push(5); l8.push(...v.f64s.map((x): [number, boolean] => [x, true])); }
    else if ('str' in v) l4.push(sid(v.str));
    else if ('dbl' in v) l8.push([v.dbl, true]);
    else if ('i64' in v) l8.push([v.i64, false]);
    else if ('blob' in v) { if (version === 1) { l4.push(v.blob.length); l1.push(v.blob); } else blobs.push(v.blob); }
    else if ('obj' in v) { l4.push(v.obj.length); for (const [k, x] of v.obj) { types.push(typeOf(x)); l4.push(sid(k)); body(x); } }
    else if ('arr' in v) { l4.push(v.arr.length); for (const x of v.arr) { types.push(typeOf(x)); body(x); } }
  };
  types.push(typeOf(root));
  body(root);
  const ones = Buffer.concat(l1);
  const ints = [strings.length, ...l4];
  const b4 = Buffer.alloc(ints.length * 4);
  ints.forEach((n, i) => b4.writeInt32LE(n, i * 4));
  const b8 = Buffer.alloc(l8.length * 8);
  l8.forEach(([n, dbl], i) => (dbl ? b8.writeDoubleLE(n, i * 8) : b8.writeBigInt64LE(BigInt(n), i * 8)));
  const text = Buffer.from(strings.map((x) => `${x}\0`).join(''));
  const frames = blobs.map(lz4Literals);
  const blobTable = blobs.length
    ? Buffer.concat([...blobs.map((b) => u32(b.length)), u32(TRAILER), ...frames.map((f) => { const s = Buffer.alloc(2); s.writeUInt16LE(f.length); return s; })])
    : u32(TRAILER);
  const before4 = Buffer.concat([ones, pad(ones.length, 4), b4]);
  const raw = Buffer.concat([before4, pad(before4.length, 8), b8, text, Buffer.from(types), blobTable]);
  const packed = lz4Literals(raw);
  if (version === 1) {
    const head = Buffer.alloc(40);
    head.writeUInt32LE(0x4b563301, 0);
    head.writeUInt32LE(1, 20); // LZ4
    head.writeInt32LE(ones.length, 24); head.writeInt32LE(ints.length, 28); head.writeInt32LE(l8.length, 32); head.writeInt32LE(raw.length, 36);
    return Buffer.concat([head, packed]);
  }
  const head = Buffer.alloc(64);
  head.writeUInt32LE(0x4b563302, 0);
  head.writeUInt32LE(1, 20); // LZ4
  head.writeUInt16LE(16384, 26);
  head.writeInt32LE(ones.length, 28); head.writeInt32LE(ints.length, 32); head.writeInt32LE(l8.length, 36);
  head.writeInt32LE(text.length + types.length, 40);
  head.writeInt32LE(raw.length, 48); head.writeInt32LE(packed.length, 52);
  head.writeInt32LE(blobs.length, 56); head.writeInt32LE(blobs.reduce((a, b) => a + b.length, 0), 60);
  return Buffer.concat([head, packed, ...(blobs.length ? [...frames, u32(TRAILER)] : [])]);
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

/** An operator that colours a particle from a control point, into the range [0, outMax]. */
const remap = (cp: number, outMax: number[] = [1, 1, 1]): V => ({ obj: [
  ['_class', { str: 'C_INIT_RemapCPtoVector' }],
  ['m_nCPInput', { int: cp }],
  ['m_nFieldOutput', { int: 6 }],
  ['m_vInputMax', { f64s: [255, 255, 255] }],
  ['m_vOutputMax', { f64s: outMax }],
  ['m_flOpStrength', { obj: [['m_nType', { str: 'PF_TYPE_CONTROL_POINT_COMPONENT' }], ['m_flOutput1', { one: true }]] }],
] });

/** A compiled resource: the blocks in the order given, each 16-byte aligned like the game's. */
function resource(blocks: [string, Buffer][]): Buffer {
  const head = Buffer.alloc(16 + blocks.length * 12);
  head.writeUInt16LE(12, 4);
  head.writeUInt32LE(8, 8);
  head.writeUInt32LE(blocks.length, 12);
  const parts: Buffer[] = [head];
  let at = head.length;
  blocks.forEach(([name, data], k) => {
    const gap = pad(at, 16);
    parts.push(gap, data);
    at += gap.length;
    const e = 16 + k * 12;
    head.write(name, e, 'ascii');
    head.writeUInt32LE(at - (e + 4), e + 4);
    head.writeUInt32LE(data.length, e + 8);
    at += data.length;
  });
  const out = Buffer.concat(parts);
  out.writeUInt32LE(out.length, 0);
  return out;
}

const particle = (data: Buffer) => resource([['RERL', Buffer.from('references')], ['DATA', data]]);

/** A member of an object node, by a path of names and array indexes. */
function at(node: Kv3Node, ...p: (string | number)[]): Kv3Node {
  let n = node;
  for (const k of p) n = typeof k === 'number' ? (n as Extract<Kv3Node, { kind: 'array' }>).items[k] : (n as Extract<Kv3Node, { kind: 'object' }>).members.get(k)!;
  return n;
}
const range = (kv: ReturnType<typeof readKv3>, n: Kv3Node) => (n as Extract<Kv3Node, { kind: 'array' }>).items.map((x) => +readCell(kv, (x as { cell: NonNullable<Parameters<typeof readCell>[1]> }).cell).toFixed(3));

const PINK: Rgb = [255, 193, 220];
const GEM: Rgb = [255, 60, 40];

/** Terrorblade's detail tint: exists($GemColor) ? $GemColor : float3(0.349, 0.735, 1.0). */
const float = (n: number) => { const b = Buffer.alloc(5); b[0] = 0x07; b.writeFloatLE(n, 1); return b; };
const GEM_TOKEN = Buffer.from('e6164651', 'hex');
const TINT = Buffer.concat([
  Buffer.from([0x1f]), GEM_TOKEN, Buffer.from([0x04, 10, 0, 18, 0]), // 0: exists, 5: branch to 10 or 18
  Buffer.from([0x19]), GEM_TOKEN, Buffer.from([0x02, 36, 0]), // 10: $GemColor, 15: jump to the end
  float(0.349), float(0.735), float(1), Buffer.from([0x06, 0x19, 0]), // 18: float3(...)
  Buffer.from([0x00]), // 36
]);

test('LZ4: literals round-trip, and a back-reference repeats what came before', () => {
  const text = Buffer.from('a block long enough to need a second length byte, and then some more');
  assert.deepEqual(lz4Decode(lz4Literals(text), text.length), text);
  assert.equal(lz4Decode(Buffer.from([0x35, 0x61, 0x62, 0x63, 3, 0]), 12).toString(), 'abcabcabcabc');
  assert.throws(() => lz4Decode(Buffer.from([0x35, 0x61, 0x62, 0x63, 9, 0]), 12), /outside the output/);
  assert.throws(() => lz4Decode(Buffer.from([0x35, 0x61, 0x62, 0x63, 3, 0]), 8), /past the output/);
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

for (const version of [1, 2] as const) {
  test(`a binary blob (version ${version}) is read, and written back at another length with everything around it kept`, () => {
    const kv = readKv3(encodeKv3({ obj: [
      ['m_nCount', { int: 7 }],
      ['m_first', { blob: Buffer.from('abc') }],
      ['m_second', { blob: Buffer.from('defgh') }],
      ['m_vScale', { f64s: [1.5, 2.5, 3.5] }],
    ] }, version));
    assert.deepEqual(kv.blobs.map((b) => b.data.toString()), ['abc', 'defgh']);
    kv.blobs[0].data = Buffer.from('a much longer first blob');
    const back = readKv3(kv.encode());
    assert.deepEqual(back.blobs.map((b) => b.data.toString()), ['a much longer first blob', 'defgh']);
    assert.equal(numberOf(back, at(back.root, 'm_nCount') as Extract<Kv3Node, { kind: 'number' }>), 7);
    assert.deepEqual(range(back, at(back.root, 'm_vScale')), [1.5, 2.5, 3.5]);
  });
}

test('the main colour becomes the chosen one, a darker one a darker shade of it, and greys stay', () => {
  assert.deepEqual(shade([0, 210, 255], PINK), PINK);
  const [r, g, b] = shade([31, 89, 88], PINK);
  assert.ok(r > g && r > b && r < 120, `a dark teal becomes a dark pink, not ${[r, g, b]}`);
  assert.deepEqual(shade([128, 128, 128], PINK), [128, 128, 128]);
  assert.deepEqual(shade([0, 0, 0], PINK), [0, 0, 0]);
});

test('a particle is recoloured in place, and a colour with no room for a channel is left whole', () => {
  const before = particle(kv3Block());
  const r = recolorResource(before, PINK);
  assert.equal(r.changed, 1);
  assert.equal(r.skipped, 1, 'm_ColorMin keeps its zero');
  const kv = readKv3(dataBlock(r.file).data);
  const get = (key: string) => kv.arrays.find((a) => a.key === key)!.cells.map((c) => (c ? readCell(kv, c) : 0));
  assert.deepEqual(get('m_ConstantColor'), [...PINK, 255]);
  assert.deepEqual(get('m_ColorMin'), [0, 210, 255], 'untouched');
  assert.equal(r.file.readUInt32LE(0), r.file.length, 'the file size in the header follows the new block');
});

test('the tint a gem gives through control point 15 is scaled so the gem comes out as the chosen colour', () => {
  // the arcana's gem is (255, 60, 40); an operator mapping it into [0, 1] must now give PINK / 255
  const block = encodeKv3({ obj: [
    ['m_ConstantColor', { i32s: [0, 210, 255, 255] }],
    ['m_Initializers', { arr: [remap(15), remap(15, [2, 2, 2]), remap(3)] }],
  ] });
  const r = recolorResource(particle(block), PINK, { gem: GEM });
  assert.equal(r.changed, 2, 'two tints from the gem, and the colour under them left as it is');
  const kv = readKv3(dataBlock(r.file).data);
  const out = (i: number) => range(kv, at(kv.root, 'm_Initializers', i, 'm_vOutputMax'));
  assert.deepEqual(out(0), [1, 3.217, 5.5], 'the gem times this range is PINK');
  assert.deepEqual(out(1), [2, 6.433, 11], 'a range of 2 keeps its brightness');
  assert.deepEqual(out(2), [1, 1, 1], 'a remap from another control point is not the gem');
  assert.deepEqual(kv.arrays.find((a) => a.key === 'm_ConstantColor')!.cells.map((c) => readCell(kv, c!)), [0, 210, 255, 255]);
});

test('a particle shared with the plain hero keeps its own colours: only the gem tint changes', () => {
  const r = recolorResource(particle(kv3Block()), PINK, { gem: GEM, own: false });
  assert.equal(r.changed, 0);
});

test('a number stored as its type alone can only become the other of 0 and 1', () => {
  const kv = readKv3(encodeKv3({ obj: [['a', { one: true }]] }));
  const a = at(kv.root, 'a') as Extract<Kv3Node, { kind: 'number' }>;
  assert.equal(setNumber(kv, a, 0.5), false);
  assert.equal(setNumber(kv, a, 0), true);
  assert.equal(numberOf(kv, at(readKv3(kv.encode()).root, 'a') as Extract<Kv3Node, { kind: 'number' }>), 0, 'and it survives being written back');
});

test('a scale with Color in its name is not taken for a colour', () => {
  const r = recolorResource(particle(encodeKv3({ obj: [['m_vecTailColorScale', { f64s: [1.5, 1.5, 1.5] }]] })), PINK);
  assert.equal(r.changed, 0);
});

test('a file with nothing to recolour comes back as it was', () => {
  const grey = particle(kv3Block([90, 90, 90, 255]));
  const r = recolorResource(grey, PINK);
  assert.equal(r.changed, 0);
  assert.equal(r.file, grey);
});

test('the name an expression reads is hashed the way the game does', () => {
  assert.equal(attributeToken('$GemColor'), GEM_TOKEN.readUInt32LE(0));
});

test('an expression reads the chosen colour instead of the gem, its jumps moved and its other branch kept', () => {
  const next = withConstant(TINT, attributeToken('$GemColor'), [1, 0.5, 0.25])!;
  const want = Buffer.concat([
    Buffer.from([0x1f]), GEM_TOKEN, Buffer.from([0x04, 10, 0, 31, 0]),
    float(1), float(0.5), float(0.25), Buffer.from([0x06, 0x19, 0]), Buffer.from([0x02, 49, 0]),
    float(0.349), float(0.735), float(1), Buffer.from([0x06, 0x19, 0]),
    Buffer.from([0x00]),
  ]);
  assert.deepEqual(next, want);
  assert.equal(withConstant(TINT, attributeToken('$SomethingElse'), [1, 1, 1]), null, 'nothing to replace');
  assert.equal(withConstant(Buffer.from([0x0a, 0x00]), attributeToken('$GemColor'), [1, 1, 1]), null, 'an opcode it does not know');
});

/** A KV3 material: one expression in a blob, and an INSG block after DATA, as the game writes them. */
const kv3Material = (code: Buffer) => resource([
  ['RERL', Buffer.from('references')],
  ['DATA', encodeKv3({ obj: [
    ['m_materialName', { str: 'materials/test.vmat' }],
    ['m_dynamicParams', { arr: [{ obj: [['m_name', { str: 'g_vDetail1ColorTint' }], ['m_value', { blob: code }]] }] }],
  ] })],
  ['INSG', Buffer.from('input signature, kept as it was')],
]);

/**
 * An NTRO material: struct descriptions for MaterialResourceData_t (its m_dynamicParams) and
 * MaterialParamBuffer_t (m_name from its base, m_value), then the data with one expression.
 */
function ntroMaterial(code: Buffer): Buffer {
  const structs = [
    { id: 1, name: 'MaterialParam_t', size: 4, base: 0, fields: [['m_name', 0]] },
    { id: 2, name: 'MaterialParamBuffer_t', size: 12, base: 1, fields: [['m_value', 4]] },
    { id: 3, name: 'MaterialResourceData_t', size: 8, base: 0, fields: [['m_dynamicParams', 0]] },
  ] as const;
  const fieldCount = structs.reduce((a, s) => a + s.fields.length, 0);
  const listAt = 20;
  const fieldsAt = listAt + structs.length * 40;
  const textAt = fieldsAt + fieldCount * 24;
  const names: Buffer[] = [];
  let textEnd = textAt;
  const name = (s: string) => { const at = textEnd; names.push(Buffer.from(`${s}\0`)); textEnd += s.length + 1; return at; };
  const ntro = Buffer.alloc(textAt);
  ntro.writeUInt32LE(4, 0); ntro.writeUInt32LE(listAt - 4, 4); ntro.writeUInt32LE(structs.length, 8);
  let f = fieldsAt;
  structs.forEach((s, i) => {
    const e = listAt + i * 40;
    ntro.writeUInt32LE(s.id, e + 4);
    ntro.writeUInt32LE(name(s.name) - (e + 8), e + 8);
    ntro.writeUInt16LE(s.size, e + 20);
    ntro.writeUInt32LE(s.base, e + 24);
    ntro.writeUInt32LE(f - (e + 28), e + 28);
    ntro.writeUInt32LE(s.fields.length, e + 32);
    for (const [fname, off] of s.fields) {
      ntro.writeUInt32LE(name(fname) - f, f);
      ntro.writeInt16LE(off, f + 6);
      f += 24;
    }
  });
  // data: the root (pointer and count), one element, its name, its code
  const data = Buffer.alloc(8 + 12);
  data.writeUInt32LE(8 - 0, 0); data.writeUInt32LE(1, 4);
  const paramName = Buffer.from('g_vDetail1ColorTint\0');
  data.writeUInt32LE(20 - 8, 8); // m_name, from its own position
  data.writeUInt32LE(20 + paramName.length - 12, 12); data.writeUInt32LE(code.length, 16);
  return resource([['RERL', Buffer.from('references')], ['NTRO', Buffer.concat([ntro, ...names])], ['DATA', Buffer.concat([data, paramName, code])]]);
}

for (const [container, build] of [['KV3', kv3Material], ['NTRO', ntroMaterial]] as const) {
  test(`${container === 'NTRO' ? 'an' : 'a'} ${container} material reads the chosen colour where it read the gem's`, () => {
    const before = build(TINT);
    assert.deepEqual(materialExpressions(before), [{ name: 'g_vDetail1ColorTint', code: TINT }]);
    const r = recolorMaterial(before, [255, 0, 0]);
    assert.equal(r.changed, 1);
    const [e] = materialExpressions(r.file);
    assert.equal(e.name, 'g_vDetail1ColorTint');
    assert.equal(e.code.length, TINT.length + 13, 'three numbers and a call where one read was');
    assert.equal(e.code.readFloatLE(11), 1);
    assert.equal(e.code.includes(Buffer.concat([Buffer.from([0x19]), GEM_TOKEN])), false, 'the gem is no longer read');
    assert.equal(r.file.readUInt32LE(0), r.file.length);
    for (const b of resourceBlocks(r.file)) assert.equal(b.at % 16, 0, `${b.name} stays aligned`);
    if (container === 'KV3') {
      const insg = resourceBlocks(r.file).find((b) => b.name === 'INSG')!;
      assert.equal(r.file.toString('ascii', insg.at, insg.at + insg.size), 'input signature, kept as it was');
    }
  });
}

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
  const arcana = 'particles/econ/items/terrorblade/terrorblade_horns_arcana';
  const hero = 'particles/units/heroes/hero_terrorblade';
  const tinted = particle(encodeKv3({ obj: [['m_Initializers', { arr: [remap(15)] }]] }));
  fs.writeFileSync(pak01, buildVpk([
    entryAt(`${arcana}/glow.vpcf_c`, particle(kv3Block())),
    entryAt(`${arcana}/smoke.vpcf_c`, particle(kv3Block([90, 90, 90, 255]))),
    entryAt(`${arcana}/broken.vpcf_c`, Buffer.from('not a resource, not long enough either')),
    entryAt(`${hero}/sword.vpcf_c`, tinted),
    entryAt(`${hero}/plain.vpcf_c`, particle(kv3Block())),
    entryAt('materials/models/heroes/terrorblade/armor.vmat_c', kv3Material(TINT)),
    entryAt('particles/units/heroes/hero_axe/axe_attack.vpcf_c', particle(kv3Block())),
  ]));
  const out = buildRecolor({ pak01, set: 'terrorblade-arcana', target: PINK });
  assert.equal(out.files, 3, 'the arcana\'s glow, the hero\'s gem tint and the armour; not the grey smoke, the hero\'s own colours or Axe');
  assert.equal(out.failed.length, 1);
  assert.match(out.failed[0].path, /broken/);
  const mod = path.join(dir, 'mod_dir.vpk');
  fs.writeFileSync(mod, out.vpk);
  const read = (p: string) => openVpkIndex(mod).read(p) as Buffer;
  const glow = readKv3(dataBlock(read(`${arcana}/glow.vpcf_c`)).data);
  assert.deepEqual(glow.arrays[0].cells.map((c) => readCell(glow, c!)), [...PINK, 255]);
  const sword = readKv3(dataBlock(read(`${hero}/sword.vpcf_c`)).data);
  assert.deepEqual(range(sword, at(sword.root, 'm_Initializers', 0, 'm_vOutputMax')), [1, 3.217, 5.5]);
  assert.equal(materialExpressions(read('materials/models/heroes/terrorblade/armor.vmat_c'))[0].code.length, TINT.length + 13);
  assert.throws(() => buildRecolor({ pak01, set: 'nobody', target: PINK }), /no set/);
});

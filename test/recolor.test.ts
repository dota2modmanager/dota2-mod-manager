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

import { lz4Decode, lz4Literals, readKv3, readCell } from '../src/kv3.ts';
import { buildRecolor, dataBlock, recolorResource, shade, type Rgb } from '../src/recolor.ts';
import { buildVpk, entryAt, openVpkIndex } from '../src/vpk.ts';

/** A KV3 v2 block: { m_ConstantColor: [0,210,255,255], m_nMaxParticles: 500, m_bSaturateColorPreAlphaBlend: true, m_ColorMin: [0,210,255] } */
function kv3Block(color: number[] = [0, 210, 255, 255]): Buffer {
  const strings = ['m_ConstantColor', 'm_nMaxParticles', 'm_bSaturateColorPreAlphaBlend', 'm_ColorMin'];
  const ints = [strings.length, 4, 0, 4, ...color, 1, 500, 2, 3, 3];
  const longs = [210n, 255n];
  // object, typed array of INT32, INT32, INT32, true, array of zero / INT64 / INT64
  const types = Buffer.from([9, 10, 11, 11, 13, 8, 15, 3, 3]);
  const text = Buffer.from(strings.map((s) => `${s}\0`).join(''));
  const l4 = Buffer.alloc(ints.length * 4);
  ints.forEach((n, i) => l4.writeInt32LE(n, i * 4));
  const l8 = Buffer.alloc(longs.length * 8);
  longs.forEach((n, i) => l8.writeBigInt64LE(n, i * 8));
  const pad = Buffer.alloc((8 - (l4.length % 8)) % 8);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32LE(0xffeedd00);
  const raw = Buffer.concat([l4, pad, l8, text, types, trailer]);
  const packed = lz4Literals(raw);
  const head = Buffer.alloc(64);
  head.writeUInt32LE(0x4b563302, 0);
  head.writeUInt32LE(1, 20); // LZ4
  head.writeUInt16LE(16384, 26);
  head.writeInt32LE(0, 28); head.writeInt32LE(ints.length, 32); head.writeInt32LE(longs.length, 36);
  head.writeInt32LE(text.length + types.length, 40);
  head.writeUInt16LE(1, 44); head.writeUInt16LE(2, 46);
  head.writeInt32LE(raw.length, 48); head.writeInt32LE(packed.length, 52);
  return Buffer.concat([head, packed]);
}

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

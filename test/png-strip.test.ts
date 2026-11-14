/* A cube map's six faces as one strip for the 3D preview (src/png-strip.ts): PNGs read and written
 * without an image library, the faces laid out in their order, and a material's cube map kept only
 * where its switch is on (src/loadout-material.ts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { CUBE_FACES, cubeStrip, decodePng, encodePng } from '../src/png-strip.ts';
import { cubeAt } from '../src/model-glb.ts';

const face = (size: number, rgb: [number, number, number]) => {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set([...rgb, 255], i * 4);
  return encodePng(size, size, px);
};

test('a PNG goes out and back the same, and an RGB one with every row filter reads as RGBA', () => {
  const px = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 9, 9, 255]);
  assert.deepEqual(decodePng(encodePng(2, 2, px)), { width: 2, height: 2, rgba: px });
  // three rows of RGB, filtered sub, up and Paeth, as an encoder that is not this one writes them
  const raw = Buffer.from([1, 10, 20, 30, 5, 5, 5, 2, 1, 1, 1, 1, 1, 1, 4, 2, 2, 2, 2, 2, 2]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(3, 4); ihdr[8] = 8; ihdr[9] = 2;
  const chunk = (kind: string, body: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(body.length, 0); h.write(kind, 4, 'latin1'); return Buffer.concat([h, body, Buffer.alloc(4)]); };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const out = decodePng(png)!;
  assert.deepEqual([...out.rgba.subarray(0, 8)], [10, 20, 30, 255, 15, 25, 35, 255], 'sub adds the pixel to the left');
  assert.deepEqual([...out.rgba.subarray(8, 16)], [11, 21, 31, 255, 16, 26, 36, 255], 'up adds the pixel above');
  assert.deepEqual([...out.rgba.subarray(16, 20)], [13, 23, 33, 255], 'Paeth takes the nearest of left, up and corner');
  assert.equal(decodePng(Buffer.from('not a png')), null);
});

test('a palette PNG reads as RGBA, its tRNS as the opacity of each colour', () => {
  // two pixels, indices 1 and 0, filter none; colour 0 half clear by tRNS
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 3;
  const chunk = (kind: string, body: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32BE(body.length, 0); h.write(kind, 4, 'latin1'); return Buffer.concat([h, body, Buffer.alloc(4)]); };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from([10, 20, 30, 200, 100, 50])), chunk('tRNS', Buffer.from([128])),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 1, 0]))), chunk('IEND', Buffer.alloc(0))]);
  assert.deepEqual([...decodePng(png)!.rgba], [200, 100, 50, 255, 10, 20, 30, 128]);
  const noPalette = Buffer.concat([png.subarray(0, 33), png.subarray(png.indexOf('IDAT') - 4)]);
  assert.equal(decodePng(noPalette), null, 'a palette picture without its palette is not read');
});

test("six faces become one strip in their order, +X first; faces that do not match make none", () => {
  const colours: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 255, 255], [0, 0, 0]];
  const strip = decodePng(cubeStrip(colours.map((c) => face(4, c)))!)!;
  assert.deepEqual([strip.width, strip.height], [24, 4]);
  colours.forEach((c, i) => assert.deepEqual([...strip.rgba.subarray((4 * i + 1) * 4, (4 * i + 1) * 4 + 3)], c, `${CUBE_FACES[i]} in place ${i}`));
  assert.equal(cubeStrip(colours.slice(0, 5).map((c) => face(4, c))), null);
  assert.equal(cubeStrip([face(4, [0, 0, 0]), ...colours.slice(1).map((c) => face(8, c))]), null);
});

test("the toolchain's six faces are made a strip once, beside them, where the preview looks for the texture", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-cube-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = path.join(root, 'materials', 'models', 'cubemaps', 'glossy_cube_tga_4cca90d9');
  fs.mkdirSync(path.dirname(base), { recursive: true });
  assert.equal(cubeAt(root, 'materials/models/cubemaps/glossy_cube_tga_4cca90d9.vtex'), null, 'no faces, no strip');
  for (const f of CUBE_FACES) fs.writeFileSync(`${base}_${f}.png`, face(2, [f === 'up' ? 200 : 0, 0, 0]));
  const at = cubeAt(root, 'materials/models/cubemaps/glossy_cube_tga_4cca90d9.vtex');
  assert.equal(at, `${base}.png`);
  assert.equal(decodePng(fs.readFileSync(at!))!.width, 12);
});

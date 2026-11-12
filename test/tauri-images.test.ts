// The Tauri host's nativeImage (src-tauri/host/images.ts): what the main process asks of Electron's
// image codec, a PNG in, its pixels as BGRA, a smaller copy, a PNG out, without Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { makeNativeImage } from '../src-tauri/host/images.ts';
import { decodePng, encodePng } from '../src/png-strip.ts';

const nativeImage = makeNativeImage((o) => o);

// 4x2: left half red, right half blue, all opaque
const rgba = Buffer.alloc(4 * 2 * 4);
for (let i = 0; i < 8; i++) rgba.set((i % 4) < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
const png = encodePng(4, 2, rgba);

test('a PNG read from bytes and from a file has its size and its pixels as BGRA', () => {
  const img = nativeImage.createFromBuffer(png);
  assert.equal(img.isEmpty(), false);
  assert.deepEqual(img.getSize(), { width: 4, height: 2 });
  assert.deepEqual([...img.toBitmap().subarray(0, 4)], [0, 0, 255, 255]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-img-')), 'a.png');
  fs.writeFileSync(file, png);
  assert.deepEqual(nativeImage.createFromPath(file).getSize(), { width: 4, height: 2 });
  assert.equal(nativeImage.createFromPath(file + '.missing').isEmpty(), true);
  assert.equal(nativeImage.createFromBuffer(Buffer.from('not a png')).isEmpty(), true);
});

test('pixels from a bitmap come back out as the same PNG', () => {
  const bgra = nativeImage.createFromBuffer(png).toBitmap();
  const back = decodePng(nativeImage.createFromBitmap(bgra, { width: 4, height: 2 }).toPNG());
  assert.ok(back);
  assert.ok(back.rgba.equals(rgba));
});

test('resize averages down and keeps the aspect when one side is given', () => {
  const small = nativeImage.createFromBuffer(png).resize({ width: 2 });
  assert.deepEqual(small.getSize(), { width: 2, height: 1 });
  const px = decodePng(small.toPNG());
  assert.ok(px);
  assert.deepEqual([...px.rgba], [255, 0, 0, 255, 0, 0, 255, 255]);
  assert.match(small.toDataURL(), /^data:image\/png;base64,/);
});

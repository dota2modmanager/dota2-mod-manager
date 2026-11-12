/* A GLB with its pictures inside, for the 3D preview (src/glb-embed.ts): the window gets bytes and
 * has no folder to follow a texture's link into. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BLANK_PNG, embedGlb, readGlb, writeGlb } from '../src/glb-embed.ts';

function folder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mm-glb-'));
}

test('the two chunks come back as they went in, each padded to four bytes', () => {
  const json = { buffers: [{ byteLength: 5 }], images: [] };
  const out = writeGlb(json, Buffer.from([1, 2, 3, 4, 5]));
  assert.equal(out.length % 4, 0);
  assert.equal(out.readUInt32LE(8), out.length);
  const back = readGlb(out);
  assert.deepEqual(back.json, json);
  assert.deepEqual([...back.bin.subarray(0, 5)], [1, 2, 3, 4, 5]);
  assert.throws(() => readGlb(Buffer.from('not a model at all')), /GLB/);
});

test('a linked picture goes into the binary chunk and the image points at its slice', () => {
  const dir = folder();
  const picture = Buffer.from('a png, as far as the test cares');
  fs.writeFileSync(path.join(dir, 'skin color.png'), picture);
  const geometry = Buffer.from([9, 9, 9]);
  fs.writeFileSync(path.join(dir, 'm.glb'), writeGlb({
    buffers: [{ byteLength: 3 }], bufferViews: [{ buffer: 0, byteLength: 3 }], images: [{ uri: 'skin%20color.png' }],
  }, geometry));
  const { json, bin } = readGlb(embedGlb(path.join(dir, 'm.glb')));
  const img = json.images![0];
  assert.equal(img.uri, undefined);
  assert.equal(img.mimeType, 'image/png');
  const view = json.bufferViews![img.bufferView!];
  assert.equal(view.byteOffset! % 4, 0);
  assert.deepEqual(bin.subarray(view.byteOffset, view.byteOffset! + view.byteLength), picture);
  assert.deepEqual([...bin.subarray(0, 3)], [9, 9, 9], 'the geometry stays where its views say');
  assert.equal(json.buffers![0].byteLength, bin.length);
});

test('a missing picture, or one outside the folder, becomes the blank pixel rather than a hole', () => {
  const dir = folder();
  fs.writeFileSync(path.join(path.dirname(dir), 'secret.png'), 'outside');
  fs.writeFileSync(path.join(dir, 'm.glb'), writeGlb({ images: [{ uri: 'gone.png' }, { uri: `../${'secret.png'}` }, { uri: 'x.tga' }] }, Buffer.alloc(0)));
  const { json, bin } = readGlb(embedGlb(path.join(dir, 'm.glb')));
  for (const img of json.images!) {
    const view = json.bufferViews![img.bufferView!];
    assert.equal(img.mimeType, 'image/png');
    assert.deepEqual(bin.subarray(view.byteOffset, view.byteOffset! + view.byteLength), BLANK_PNG);
  }
});

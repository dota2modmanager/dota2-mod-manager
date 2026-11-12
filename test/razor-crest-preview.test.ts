import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readGlb, writeGlb } from '../src/glb-embed.ts';
import { normalCrestOnGoldenRig } from '../src/razor-crest-preview.ts';

test('Severing Crest uses the donor rig and keeps the original material and embedded color', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'razor-crest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'gold.glb');
  const meshes = [{ primitives: [{ material: 0 }] }];
  const donor = { meshes, materials: [{ name: 'gold' }], nodes: [{ name: 'working head rig' }] };
  fs.writeFileSync(file, writeGlb(donor as never, Buffer.alloc(0)));
  const texture = Buffer.from([1, 2, 3, 4]);
  const original = { meshes, materials: [{ name: 'blue' }], images: [{ bufferView: 0, mimeType: 'image/png' }],
    bufferViews: [{ buffer: 0, byteLength: texture.length }] };
  const result = normalCrestOnGoldenRig(writeGlb(original, texture), file);
  assert.ok(result);
  const gltf = readGlb(result).json as Record<string, unknown>;
  assert.deepEqual(gltf.nodes, donor.nodes);
  assert.deepEqual(gltf.materials, original.materials);
  assert.deepEqual(gltf.images, [{ uri: `data:image/png;base64,${texture.toString('base64')}` }]);
  const mismatched = { ...original, meshes: [{ primitives: [{ material: 1 }] }] };
  assert.equal(normalCrestOnGoldenRig(writeGlb(mismatched, texture), file), null);
});

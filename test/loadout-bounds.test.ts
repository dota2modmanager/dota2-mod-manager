import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import { loadoutParticleBounds } from '../renderer/catalog/preview3d/loadout-bounds.ts';

test('isolated effects frame live geometry in metres before their first rendered frame', () => {
  const source = new Group();
  source.matrixAutoUpdate = false;
  source.matrix.makeScale(0.0254, 0.0254, 0.0254);
  const geometry = new BufferGeometry();
  // The second triangle belongs to the previous particle batch, outside the live draw range.
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 10, 0, 0, 0, 10, 0, 1000, 1000, 1000], 3));
  geometry.setIndex([0, 1, 2, 3, 3, 3]);
  geometry.setDrawRange(0, 3);
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.position.set(20, 30, 0);
  source.add(mesh);
  const box = loadoutParticleBounds(source);
  assert.ok(Math.abs(box.min.x - 20 * 0.0254) < 1e-6);
  assert.ok(Math.abs(box.max.x - 30 * 0.0254) < 1e-6);
  assert.ok(Math.abs(box.max.y - 40 * 0.0254) < 1e-6);
  mesh.visible = false;
  assert.equal(loadoutParticleBounds(source).isEmpty(), true);
  geometry.dispose(); mesh.material.dispose();
});

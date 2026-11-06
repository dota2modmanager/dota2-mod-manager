/* The 3D preview's free camera (renderer/catalog/preview3d/camera.ts) and how a wearable finds the
 * hero's bones (bonemerge.ts). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TILT, ZOOM, cameraAt, clampTilt, keyMove, stepZoom } from '../renderer/catalog/preview3d/camera.ts';
import { bonesByName, boneKey, linkBones } from '../renderer/catalog/preview3d/bonemerge.ts';

const skeleton = (...names: string[]) => {
  const root = new THREE.Group();
  for (const n of names) { const b = new THREE.Bone(); b.name = n; root.add(b); }
  return root;
};

test('the camera starts level, in front of the hero, and climbs an arc of the same radius', () => {
  const target = { x: 0, y: 2, z: 0 };
  assert.deepEqual(cameraAt(target, { x: 0, z: 1 }, 0, 10), { x: 0, y: 2, z: 10 });
  const up = cameraAt(target, { x: 0, z: 1 }, 1, 10);
  assert.ok(Math.abs(Math.hypot(up.x, up.y - 2, up.z) - 10) < 1e-9);
  assert.ok(up.y > 2);
});

test('the tilt and the zoom stop at their ends', () => {
  assert.equal(clampTilt(9), TILT.max);
  assert.equal(clampTilt(-9), TILT.min);
  let z = 1;
  for (let i = 0; i < 100; i++) z = stepZoom(z, -1);
  assert.equal(z, ZOOM.min);
  for (let i = 0; i < 100; i++) z = stepZoom(z, 1);
  assert.equal(z, ZOOM.max);
});

test('the keys carry the camera by its distance, faster with Shift, and opposite keys cancel', () => {
  assert.deepEqual(keyMove(new Set(['KeyD', 'KeyW', 'KeyE']), 1, 10), { right: 5, forward: 5, up: 5 });
  assert.deepEqual(keyMove(new Set(['KeyA', 'KeyS', 'KeyQ']), 1, 10), { right: -5, forward: -5, up: -5 });
  assert.equal(keyMove(new Set(['KeyA', 'ShiftLeft']), 1, 10).right, -15);
  assert.equal(keyMove(new Set(['KeyA', 'KeyD']), 1, 10).right, 0);
  assert.equal(keyMove(new Set(), 1, 10).right, 0);
});

test('a wearable finds a bone its model spells otherwise than the hero (Axe: clavicle_r, Clavicle_R)', () => {
  const hero = bonesByName(skeleton('Clavicle_R', 'head'));
  const [armour, cape] = linkBones(skeleton('clavicle_r', 'cloth_r0c0'), hero);
  assert.equal(armour.to?.name, 'Clavicle_R');
  // a bone the hero lacks hangs off its own parent
  assert.equal(cape.to, null);
  assert.equal(armour.bone.matrixAutoUpdate, false);
});

test('the first bone of a name stands for it', () => {
  const root = skeleton('Head', 'head');
  assert.equal(bonesByName(root).get(boneKey('HEAD'))?.name, 'Head');
});

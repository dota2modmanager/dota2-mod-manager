/* How a hero material lies over what is behind it (renderer/catalog/preview3d/hero-material.ts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { blendOf, rimScale } from '../renderer/catalog/preview3d/hero-material.ts';

test('a usual rim stays as written, and a huge one stops short of washing the surface out', () => {
  assert.equal(rimScale(2), 2);
  assert.equal(rimScale(10), 3);
});

test('a solid material hides what is behind it', () => {
  assert.deepEqual(blendOf({}), { transparent: false, depthWrite: true, blending: THREE.NormalBlending });
});

test('a translucent material lets it through', () => {
  assert.deepEqual(blendOf({ F_TRANSLUCENT: 1 }), { transparent: true, depthWrite: false, blending: THREE.NormalBlending });
});

test('an additive material only brightens it', () => {
  assert.deepEqual(blendOf({ F_ADDITIVE_BLEND: 1 }), { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
});

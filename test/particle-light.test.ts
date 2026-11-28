// The light the game puts on the effects it tints by the map's light (m_bTintByGlobalLight):
// renderer/catalog/decor/map-light.ts particleLight, read by vendor/dota-loadout's sprite and trail renderers.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { lit, particleLight } from '../renderer/catalog/decor/map-light.ts';

const near = (a: number[], b: number[]) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-6, `${a} != ${b}`));
// the game's axes from the window's: (y, z, x) back to (x, y, z)
const game = (v: THREE.Vector3) => new THREE.Vector3(v.z, v.x, v.y);

function setLight() {
  lit.uSunDir.value.set(0, -1, 0); // straight down
  lit.uAmbientDir.value.set(1, 0, 0);
  lit.uSun.value.setRGB(3, 2, 1);
  lit.uAmbient.value.setRGB(0.1, 0.2, 0.4);
  lit.uShadeUp.value.setRGB(1, 1, 1);
  lit.uShadeDown.value.setRGB(0, 0, 0);
}

test('a card facing the sun takes the whole sun and none of the sky', () => {
  setLight();
  near(particleLight(game(new THREE.Vector3(0, 1, 0))).toArray(), [3, 2, 1]);
});

test('a card the sun does not reach takes the ambient and the sky by its height', () => {
  setLight();
  // facing the ambient's way, level: the sky halfway between its two colours
  near(particleLight(game(new THREE.Vector3(1, 0, 0))).toArray(), [0.6, 0.7, 0.9]);
  // facing down: the sky's lower colour, black here
  near(particleLight(game(new THREE.Vector3(0, -1, 0))).toArray(), [0, 0, 0]);
});

// The 3D map's camera as the game's (renderer/catalog/decor/map-camera.ts): its distance, view and fog by the zoom.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { distanceAt, dotaCamera, fogAt, fovAt, START_ZOOM, verticalFov } from '../renderer/catalog/decor/map-camera.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("a player's zoom runs 1134 to 1200 and a spectator's on to 2600", () => {
  near(distanceAt(0), 1134);
  near(distanceAt(START_ZOOM), 1200);
  near(distanceAt(1), 2600);
  near(fovAt(0), 45);
  near(fovAt(0.5), 70);
  near(fovAt(1), 55);
  near(verticalFov(70), 66);
});

test("the camera's fog is the zone's at a player's zoom, nearer zoomed in, farther out", () => {
  assert.deepEqual(fogAt(0.5, 1250, 4500), [1250, 4500]);
  assert.deepEqual(fogAt(0, 1250, 4500), [2000, 2500]);
  assert.deepEqual(fogAt(1, 1250, 4500), [4500, 6000]);
});

test('the camera stands south of what it looks at, 60° up, and the wheel stops at both ends', () => {
  const camera = new THREE.PerspectiveCamera();
  const target = new THREE.Vector3(1, 2, 3);
  const zooms: number[] = [];
  const dota = dotaCamera(camera, target, (z) => zooms.push(z));
  assert.equal(dota.step(0.016), true);
  const back = camera.position.clone().sub(target);
  near(back.length() / 0.0254, 1200, 1e-3);
  near(THREE.MathUtils.radToDeg(Math.atan2(back.y, -back.x)), 60, 1e-6);
  near(back.z, 0);
  assert.equal(dota.step(0.016), false, 'still: nothing to draw again');
  dota.wheel(100);
  for (let i = 0; i < 2000; i++) dota.step(0.05);
  near(dota.zoom, 1);
  dota.wheel(-100);
  for (let i = 0; i < 2000; i++) dota.step(0.05);
  near(dota.zoom, 0);
  near(camera.position.distanceTo(target) / 0.0254, 1134, 1e-3);
});

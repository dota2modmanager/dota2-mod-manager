import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { drawnBox } from '../renderer/catalog/preview3d/effect-frame.ts';

/** A black frame with a square of the given colour and alpha. */
function frame(width: number, height: number, at: [number, number, number], rgba: number[]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  const [x0, y0, size] = at;
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) px.set(rgba, (y * width + x) * 4);
  return px;
}

test('an additive particle counts as drawn: colour with no alpha', () => {
  assert.ok(drawnBox(frame(64, 36, [10, 10, 6], [200, 180, 40, 0]), 64, 36));
});

test('a black frame has no picture', () => {
  assert.equal(drawnBox(new Uint8ClampedArray(64 * 36 * 4), 64, 36), null);
});

test('a few stray pixels have no picture', () => {
  assert.equal(drawnBox(frame(64, 36, [10, 10, 2], [255, 255, 255, 255]), 64, 36), null);
});

test('the box holds what was drawn, keeps the shape and stays in the frame', () => {
  const box = drawnBox(frame(640, 360, [600, 340, 20], [255, 0, 0, 255]), 640, 360)!;
  assert.ok(box.x + box.w <= 640 && box.y + box.h <= 360);
  assert.ok(box.x <= 600 && box.y <= 340);
  assert.ok(Math.abs(box.w / box.h - 640 / 360) < 0.01);
});

test('a small effect is cut in close, a wide one keeps its width', () => {
  assert.ok(drawnBox(frame(640, 360, [300, 170, 20], [255, 255, 255, 255]), 640, 360)!.w <= 640 / 4 + 1);
  assert.equal(drawnBox(frame(640, 360, [0, 0, 360], [255, 255, 255, 255]), 640, 360)!.h, 360);
});

test('every effect the builder says has a picture ships one', () => {
  const list = /EFFECT_PICTURES = new Set\(\[([^\]]*)\]/.exec(readFileSync('renderer/catalog/builder/logic.ts', 'utf8'))![1];
  const ids = [...list.matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 30);
  for (const id of ids) assert.ok(existsSync(`renderer/public/assets/effects/${id}.webp`), id);
});

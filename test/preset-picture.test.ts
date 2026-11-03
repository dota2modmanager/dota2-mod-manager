/* The QR code on a preset's picture (renderer/views/presets/picture.ts, issue #433): a square of
 * squares with the three finder patterns a camera looks for, small enough for the links presets
 * make. Whether a phone reads it was checked by decoding the drawn picture; this keeps the code
 * the encoder hands back in the shape the drawing assumes. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { qrModules } from '../renderer/views/presets/picture.ts';
import { encodePresetLink } from '../src/preset-link.ts';

const link = (n: number) => encodePresetLink({
  name: 'LAN', mods: Array.from({ length: n }, (_, i) => ({ categoryId: 'heroes', name: `Some Hero Mod ${i}`, styleLabel: null })) as never,
}).web;

/** A finder pattern's top-left corner: a dark 7x7 ring, a light ring inside it, a dark 3x3 middle. */
const finderAt = (m: boolean[][], r: number, c: number) => {
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const ring = Math.max(Math.abs(i - 3), Math.abs(j - 3));
      if (m[r + i][c + j] !== (ring !== 2)) return false;
    }
  }
  return true;
};

test("a preset's link is a square code with its three finder patterns", () => {
  const m = qrModules(link(8));
  const n = m.length;
  assert.ok(m.every((row) => row.length === n));
  assert.equal((n - 17) % 4, 0, 'a QR side is 17 + 4 per version');
  assert.ok(finderAt(m, 0, 0) && finderAt(m, 0, n - 7) && finderAt(m, n - 7, 0));
});

test('a preset of sixty mods still fits a code a 300 px square draws at 4 px a module', () => {
  assert.ok(qrModules(link(60)).length <= 67);
});

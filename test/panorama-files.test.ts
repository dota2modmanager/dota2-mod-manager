/* Panorama's compiled styles and scripts, read and written by the app (src/panorama-files.ts).
 *
 * The promise: a rank medal and a HUD layout go on without Valve's compiler, whose Workshop Tools
 * many users lack or have of two Dota updates (Discord, 2026-11-09: "Schema mismatches reported").
 * A style read and written again with its own CSS is the same file but its CRC, every picture the
 * new CSS names is in its list with its size, and a script is its text. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { cssImages, imagesOf, readStyle, writeScript, writeStyle } from '../src/panorama-files.ts';
import { references, resourceBlock } from '../src/resource.ts';
import { resource } from './helpers/kv3-build.ts';
import { script, style, texture } from './helpers/panorama.ts';

const RANK = 'panorama/images/rank_tier_icons/rank3_psd.vtex';
const CSS = `.A{background-image: url("s2r://${RANK}");}`;

test('a style written again with its own CSS is the same file, its CRC aside', () => {
  const file = style(CSS, [[RANK, 256, 256]]);
  const { css, images } = readStyle(file);
  assert.equal(css, CSS);
  assert.deepEqual(images, [{ path: RANK, width: 256, height: 256, crc: 0 }]);
  const again = writeStyle(file, css, () => null, () => null);
  assert.deepEqual(resourceBlock(again, 'DATA').data.subarray(4), resourceBlock(file, 'DATA').data.subarray(4));
});

test('a picture the new CSS names is listed: from another style, else at its texture’s size, and named to load', () => {
  const file = style(CSS, [[RANK, 256, 256]]);
  const other = style('', [['panorama/images/a_png.vtex', 40, 20]]);
  const next = `${CSS}.B{background-image: url("s2r://panorama/images/a_png.vtex");}.C{background-image: url("file://{images}/b.png");}.D{background-image: url("s2r://panorama/images/gone.vtex");}`;
  const out = writeStyle(file, next, imagesOf([other]), (p) => (p === 'panorama/images/b_png.vtex_c' ? texture(64, 32) : null));
  const { css, images } = readStyle(out);
  assert.equal(css, next);
  assert.deepEqual(images.map((i) => [i.path, i.width, i.height]), [[RANK, 256, 256], ['panorama/images/a_png.vtex', 40, 20], ['panorama/images/b_png.vtex', 64, 32]],
    'a picture neither has stays named in the CSS alone');
  assert.ok(references(out).includes('panorama/images/b_png.vtex'));
});

test('the pictures CSS names, as compiled textures', () => {
  assert.deepEqual(cssImages(`a{background-image:url('s2r://x/y.vtex')} b{background-image: url("file://{images}/z/w.psd")} c{wash-color: #fff;}`),
    ['x/y.vtex', 'panorama/images/z/w_psd.vtex']);
});

test('a style of version 2 has no CRC per picture, and one that is not a style is refused', () => {
  const v3 = style(CSS, [[RANK, 8, 8]]);
  const d = resourceBlock(v3, 'DATA').data;
  // the same list without the four bytes of CRC after the size
  const v2data = Buffer.concat([d.subarray(0, 6 + RANK.length + 1 + 4), d.subarray(6 + RANK.length + 1 + 8)]);
  const v2 = resourceBlock(v3, 'DATA').replace(v2data);
  v2.writeUInt16LE(2, 6);
  assert.equal(readStyle(v2).css, CSS);
  assert.throws(() => readStyle(resource([['RED2', Buffer.alloc(4)]])));
});

test('a script is the game’s with its text in place, and an old binary script is no template', () => {
  const out = writeScript(script('old()'), 'new()');
  assert.equal(resourceBlock(out, 'DATA').data.toString(), 'new()');
  const old = script();
  old.writeUInt16LE(3, 6);
  assert.throws(() => writeScript(old, 'x'));
});

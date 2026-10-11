/* The contrast the a11y scenario measures on the pixels (tools/sim/contrast.js).
 *
 * axe leaves the text over translucent panels to a person; the scenario measures it instead, and
 * a run fails on what it finds. These pin the arithmetic that verdict rests on: WCAG's ratio, a
 * translucent colour laid over a pixel, what counts as large text, and how a node's pixels are read
 * out of a capture.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ratio, over, isLarge, measure, NODES, HIDE_TEXT } = require('../tools/sim/contrast.js');

/** A BGRA frame filled with one colour, and a way to paint a block of another. */
const frame = (w, h, [r, g, b]) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) buf.set([b, g, r, 255], i * 4);
  return buf;
};
const paint = (buf, w, x0, y0, bw, bh, [r, g, b]) => {
  for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) buf.set([b, g, r, 255], (y * w + x) * 4);
};

test('the ratio is WCAG\'s: 21 for black on white, 4.54 for #767676 on white, the same either way round', () => {
  assert.equal(ratio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(ratio([255, 255, 255], [0, 0, 0]), 21);
  assert.equal(ratio([0x76, 0x76, 0x76], [255, 255, 255]).toFixed(2), '4.54');
  assert.equal(ratio([12, 200, 99], [12, 200, 99]), 1);
});

test('a translucent colour over a pixel is the mix of the two, by its alpha', () => {
  assert.deepEqual(over([200, 100, 0], 1, [0, 0, 0]), [200, 100, 0]);
  assert.deepEqual(over([200, 100, 0], 0, [10, 20, 30]), [10, 20, 30]);
  assert.deepEqual(over([200, 100, 0], 0.5, [0, 0, 100]), [100, 50, 50]);
});

test('large text is 24px, or 18.66px when bold', () => {
  assert.equal(isLarge(24, 400), true);
  assert.equal(isLarge(23.9, 400), false);
  assert.equal(isLarge(18.66, 700), true);
  assert.equal(isLarge(18.66, 600), false);
  assert.equal(isLarge(13, 900), false);
});

test('text on a flat background reads that background, and asks 4.5:1 of normal text and 3:1 of large', () => {
  const w = 40;
  const h = 20;
  const shot = { bitmap: frame(w, h, [255, 255, 255]), width: w, height: h, scale: 1 };
  const grey = { rects: [{ x: 2, y: 2, w: 20, h: 10 }], color: [0x76, 0x76, 0x76], alpha: 1, large: false };
  const r = measure(shot, grey);
  assert.equal(r.need, 4.5);
  assert.equal(r.low, 4.54);
  assert.equal(r.worst, 4.54);
  assert.equal(r.pixels, 200);
  assert.equal(r.ok, true);

  const faint = { ...grey, color: [0x96, 0x96, 0x96] };
  assert.equal(measure(shot, faint).ok, false, '#969696 on white is under 3:1 and under 4.5:1');
  assert.equal(measure(shot, { ...faint, color: [0x8a, 0x8a, 0x8a], large: true }).ok, true, '#8a8a8a is 3.45:1, enough for large text');
});

test('the text\'s own alpha counts: half-transparent black on white is not black on white', () => {
  const shot = { bitmap: frame(10, 10, [255, 255, 255]), width: 10, height: 10, scale: 1 };
  const node = { rects: [{ x: 0, y: 0, w: 10, h: 10 }], color: [0, 0, 0], large: false };
  assert.equal(measure(shot, { ...node, alpha: 1 }).low, 21);
  assert.equal(measure(shot, { ...node, alpha: 0.5 }).low, 3.98);
  assert.equal(measure(shot, { ...node, alpha: 0.5 }).ok, false);
});

test('a background that changes under the text is judged near its worst, and one stray pixel does not decide it', () => {
  const w = 100;
  const h = 10;
  const node = { rects: [{ x: 0, y: 0, w: 100, h: 10 }], color: [255, 255, 255], alpha: 1, large: false };

  // a tenth of the line sits on light grey: that tenth is what the text has to survive
  const half = frame(w, h, [0, 0, 0]);
  paint(half, w, 90, 0, 10, 10, [170, 170, 170]);
  const r = measure({ bitmap: half, width: w, height: h, scale: 1 }, node);
  assert.equal(r.ok, false);
  assert.equal(r.low, r.worst);

  // one pixel of the same grey among a thousand black ones is a stray pixel, not the background
  const speck = frame(w, h, [0, 0, 0]);
  paint(speck, w, 50, 5, 1, 1, [170, 170, 170]);
  const s = measure({ bitmap: speck, width: w, height: h, scale: 1 }, node);
  assert.equal(s.ok, true);
  assert.equal(s.low, 21);
  assert.ok(s.worst < 4.5, 'the worst pixel is still in the report');
});

test('a scaled capture reads the device pixels under the CSS box, and nothing outside the frame', () => {
  const w = 40;
  const h = 40;
  const bitmap = frame(w, h, [0, 0, 0]);
  paint(bitmap, w, 20, 20, 20, 20, [255, 255, 255]);
  const node = { rects: [{ x: 10, y: 10, w: 10, h: 10 }], color: [0, 0, 0], alpha: 1, large: false };
  // at 2x, CSS 10..20 is device 20..40: all white, so black text there is 21:1
  const r = measure({ bitmap, width: w, height: h, scale: 2 }, node);
  assert.equal(r.pixels, 400);
  assert.equal(r.low, 21);

  // a box half off the frame reads only its half on it, and a box wholly off reads nothing
  const edge = measure({ bitmap, width: w, height: h, scale: 1 }, { ...node, rects: [{ x: 30, y: 30, w: 20, h: 20 }] });
  assert.equal(edge.pixels, 100);
  assert.equal(measure({ bitmap, width: w, height: h, scale: 1 }, { ...node, rects: [{ x: 50, y: 50, w: 5, h: 5 }] }), null);
});

test('the page code parses, and the style that hides text leaves colour alone', () => {
  assert.doesNotThrow(() => new vm.Script(NODES)); // compiled, not run
  assert.match(NODES, /\\s\+/, 'a regex in the page code keeps its backslash through the template string');
  assert.match(HIDE_TEXT, /-webkit-text-fill-color: transparent/);
  // `color` is what currentColor borders and tints are drawn in, and those are background
  assert.doesNotMatch(HIDE_TEXT, /(^|[\s;{])color:/);
});

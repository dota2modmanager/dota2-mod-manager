/* The window-fits check of the simulation (tools/sim/fit.js): a window bigger than the screen is
 * caught, and the rounding a forced scale factor adds is not mistaken for one. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fitsWorkArea } = require('../tools/sim/fit.js');

const laptop125 = { width: 1093, height: 582 }; // 1366x768 at 125%, the laptop-125 profile

test('on a screen at its own scale, a window fits only inside the work area', () => {
  assert.equal(fitsWorkArea({ width: 1093, height: 582 }, laptop125), true);
  assert.equal(fitsWorkArea({ width: 1093, height: 583 }, laptop125), false, 'a pixel over is over when nothing is forced');
});

test('a forced scale factor may round a window a few pixels past the work area', () => {
  // measured: 1093x582 asked, 1096x585 on a 96 DPI screen at 1.25, 1022x583 on the Windows runner
  assert.equal(fitsWorkArea({ width: 1096, height: 585 }, laptop125, { forcedScale: true }), true);
  assert.equal(fitsWorkArea({ width: 1022, height: 583 }, laptop125, { forcedScale: true }), true);
});

test('the window the check was written for still fails with the scale forced', () => {
  // the old minimums, 1020x640, on a work area 582 high
  assert.equal(fitsWorkArea({ width: 1093, height: 640 }, laptop125, { forcedScale: true }), false);
  assert.equal(fitsWorkArea({ width: 1366, height: 582 }, laptop125, { forcedScale: true }), false);
});

/* The wheel watch's rule (renderer/core/scroll-stuck.ts, issue #330): a tick counts as stuck only
 * when the pane had room in the way it was turned and did not move. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NUDGE_AFTER, stuck, tickPx } from '../renderer/core/scroll-stuck.ts';

test('a pane with room below that stays put on a tick down is stuck', () => {
  assert.equal(stuck({ dy: 100, before: 400, after: 400, max: 1900 }), true);
  assert.equal(stuck({ dy: -100, before: 400, after: 400, max: 1900 }), true);
});

test('a pane that moved, or had nowhere to go, is not', () => {
  assert.equal(stuck({ dy: 100, before: 400, after: 500, max: 1900 }), false);
  assert.equal(stuck({ dy: 100, before: 1900, after: 1900, max: 1900 }), false, 'at the bottom, a tick down goes nowhere');
  assert.equal(stuck({ dy: -100, before: 0, after: 0, max: 1900 }), false, 'at the top, a tick up goes nowhere');
  assert.equal(stuck({ dy: 100, before: 1899.5, after: 1899.5, max: 1900 }), false, 'half a pixel short is the bottom');
});

test('a stuck pane is scrolled by the tick itself, in pixels whatever the wheel counts in', () => {
  assert.equal(NUDGE_AFTER, 2, 'one tick can be a slow frame; two in a row is the browser holding the pane');
  assert.equal(tickPx(100, 0, 790), 100);
  assert.equal(tickPx(3, 1, 790), 48, 'lines');
  assert.equal(tickPx(-1, 2, 790), -790, 'pages');
});

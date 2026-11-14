/* The interface grows with a window bigger than the one it is drawn for (renderer/ui/fit.ts): a
 * maximized window used to show the 1440-wide layout in its corner. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitFor } from '../renderer/ui/fit.ts';

test('a window the designed size or smaller keeps the chosen scale', () => {
  assert.equal(fitFor(1440, 900, 1), 1);
  assert.equal(fitFor(1100, 700, 1), 1);
});

test('a bigger window grows with its width, in steps of 5%, up to half again', () => {
  assert.equal(fitFor(1920, 1032, 1), 1.3); // full HD maximized under the taskbar
  assert.equal(fitFor(3440, 1400, 1), 1.5); // ultrawide: capped
  assert.equal(fitFor(2560, 1600, 1), 1.5);
  assert.equal(fitFor(1920, 1200, 1), 1.3);
  assert.equal(fitFor(2560, 800, 1), 1); // a strip: the height holds it back
});

test('a scale the user chose already counts toward the window it fills', () => {
  assert.equal(fitFor(1920, 1032, 1.25), 1.05);
  assert.equal(fitFor(2880, 1800, 1.6), 1.25);
});

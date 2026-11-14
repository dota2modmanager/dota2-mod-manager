/* A bigger window adds a little to the scale (renderer/ui/fit.ts): a maximized window used to show
 * the 1440-wide layout in its corner, and then 30% bigger was too much. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitFor } from '../renderer/ui/fit.ts';

test('a window the designed size or smaller adds nothing', () => {
  assert.equal(fitFor(1440, 900), 1);
  assert.equal(fitFor(1100, 700), 1);
});

test('a bigger window adds a third of how much bigger it is, in 5% steps, up to 30%', () => {
  assert.equal(fitFor(1920, 1032), 1.1); // full HD maximized under the taskbar
  assert.equal(fitFor(2560, 1392), 1.25);
  assert.equal(fitFor(3840, 2100), 1.3); // 4K: capped
  assert.equal(fitFor(2560, 800), 1); // a strip: the height holds it back
});

test('the scale in Settings plays no part, so a smaller scale is always smaller', () => {
  assert.equal(fitFor.length, 2);
  assert.ok(0.95 * fitFor(1920, 1032) < 1 * fitFor(1920, 1032));
});

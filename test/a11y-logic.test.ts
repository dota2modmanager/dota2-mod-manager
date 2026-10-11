/* Where Tab goes inside a window over the app (renderer/ui/focus-wrap.ts, used by renderer/ui/a11y.ts). The rest of that module is
 * the page itself and is checked by pressing keys in the real window: tools/sim/scenarios/a11y.js. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { wrapTarget } from '../renderer/ui/focus-wrap.ts';

test('Tab off the last control goes round to the first, and Shift+Tab off the first to the last', () => {
  const items = ['close', 'install', 'star'];
  assert.equal(wrapTarget(items, 'star', false), 'close');
  assert.equal(wrapTarget(items, 'close', true), 'star');
});

test('inside the list, Tab is left to the browser', () => {
  const items = ['close', 'install', 'star'];
  assert.equal(wrapTarget(items, 'close', false), null);
  assert.equal(wrapTarget(items, 'install', true), null);
});

test('focus that got outside the window is brought back in, from the right end', () => {
  const items = ['close', 'install', 'star'];
  assert.equal(wrapTarget(items, null, false), 'close');
  assert.equal(wrapTarget(items, null, true), 'star');
  assert.equal(wrapTarget(items, 'a card behind it', false), 'close');
});

test('a window with nothing to focus steers nowhere', () => {
  assert.equal(wrapTarget([], null, false), null);
});

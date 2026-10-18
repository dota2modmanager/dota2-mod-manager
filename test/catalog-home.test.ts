import test from 'node:test';
import assert from 'node:assert/strict';

import { RECENT_STRIP, recentStrip } from '../renderer/catalog/recent.ts';

// issue #292: the strip stopped at twelve and the rest of the catalog's recent list was nowhere
test('the front page strip shows twelve and counts the rest for the button to them', () => {
  const all = Array.from({ length: 250 }, (_, i) => i);
  const { strip, total } = recentStrip(all);
  assert.equal(strip.length, RECENT_STRIP);
  assert.deepEqual(strip, all.slice(0, RECENT_STRIP), 'newest first, as the catalog lists them');
  assert.equal(total, 250);
});

test('no button to the rest when the strip already is the whole list', () => {
  assert.equal(recentStrip([1, 2, 3]).total, 0);
  assert.equal(recentStrip(Array.from({ length: RECENT_STRIP }, (_, i) => i)).total, 0);
  assert.deepEqual(recentStrip([]), { strip: [], total: 0 });
});

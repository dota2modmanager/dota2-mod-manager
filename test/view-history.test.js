/* The sections visited, for the mouse's back and forward buttons (renderer/core/view-history.ts). */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/core/view-history.ts');

test('back and forward walk the sections like a browser, and a new visit drops the way forward', async () => {
  const { createViewHistory } = await load();
  const h = createViewHistory('home');
  assert.equal(h.back(), null, 'nothing before the first section');
  h.visit('catalog'); h.visit('library'); h.visit('library');
  assert.equal(h.back(), 'catalog', 'the same section twice is one step');
  assert.equal(h.back(), 'home');
  assert.equal(h.back(), null);
  assert.equal(h.forward(), 'catalog');
  h.visit('settings');
  assert.equal(h.forward(), null, 'library is no longer ahead');
  assert.equal(h.back(), 'catalog');
});

test('the list keeps the last fifty sections', async () => {
  const { createViewHistory } = await load();
  const h = createViewHistory('v0');
  for (let i = 1; i <= 60; i++) h.visit(`v${i}`);
  let steps = 0;
  while (h.back()) steps++;
  assert.equal(steps, 49);
});

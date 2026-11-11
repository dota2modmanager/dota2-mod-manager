/* Ctrl- and Shift-clicks on My mods' rows (renderer/library/selection.ts clickSelect). */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/library/selection.ts');
const ORDER = ['a', 'b', 'c', 'd', 'e'];

test('Ctrl ticks one row and unticks it again, and it becomes the anchor', async () => {
  const { clickSelect } = await load();
  const sel = new Set();
  assert.equal(clickSelect(sel, ORDER, '', 'c', { ctrl: true, shift: false }), 'c');
  assert.deepEqual([...sel], ['c']);
  clickSelect(sel, ORDER, 'c', 'c', { ctrl: true, shift: false });
  assert.deepEqual([...sel], []);
});

test('Shift ticks the rows between the anchor and the row, either way up, and keeps what was ticked', async () => {
  const { clickSelect } = await load();
  const sel = new Set(['a']);
  assert.equal(clickSelect(sel, ORDER, 'd', 'b', { ctrl: false, shift: true }), 'd', 'the anchor stays for the next Shift-click');
  assert.deepEqual([...sel].sort(), ['a', 'b', 'c', 'd']);
});

test('Shift with no anchor on screen ticks just the row', async () => {
  const { clickSelect } = await load();
  const sel = new Set();
  assert.equal(clickSelect(sel, ORDER, 'gone', 'e', { ctrl: false, shift: true }), 'e');
  assert.deepEqual([...sel], ['e']);
});

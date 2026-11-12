/* What the mod window says about an installed mod (renderer/catalog/modal/status.ts, plan item 2).
 *
 * The promise: a person who opens an installed mod's window to ask why it is not in the game reads
 * the reason there, with the one thing to do about it, and a mod with nothing wrong says nothing. */
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.L = (strings, ...values) => strings.reduce((s, part, i) => s + part + (i < values.length ? values[i] : ''), '');
const load = () => import('../renderer/catalog/modal/status.ts');

test('a mod with nothing wrong, or not installed, says nothing', async () => {
  const { modStates } = await load();
  assert.deepEqual(modStates(null), []);
  assert.deepEqual(modStates({ enabled: true, schemaCount: 2, schemaLive: true }), []);
});

test('switched off is the one thing said, with a switch to turn it on', async () => {
  const { modStates } = await load();
  const s = modStates({ enabled: false, coveredBy: [{ name: 'Other', files: 3 }] });
  assert.deepEqual(s.map((x) => [x.key, x.act]), [['off', 'enable']], 'a mod that is off is covered by nothing in the game');
});

test('covered, waiting for the item table and changed by a patch each get a line, the first two lead to My mods', async () => {
  const { modStates } = await load();
  const s = modStates({ enabled: true, coveredBy: [{ name: 'Other Mod', files: 3 }], schemaCount: 1, schemaLive: false, prePatch: { since: null, changed: 2, removed: 0 } });
  assert.deepEqual(s.map((x) => [x.key, x.act]), [['covered', 'library'], ['schema', 'library'], ['prePatch', null]]);
  assert.match(s[0].text, /«Other Mod»/);
  assert.deepEqual(modStates({ enabled: true, prePatch: { since: null, changed: 0, removed: 0 } }), [], 'a patch that changed none of its files');
});

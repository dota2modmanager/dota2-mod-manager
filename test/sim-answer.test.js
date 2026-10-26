/* The page code behind the simulation's waits (tools/sim/answer.js). Electron 45 clones what
 * executeJavaScript answers the way structuredClone does, and an element React drew does not
 * clone: every scenario on the Electron 45 bump stopped in its first wait with
 * "An object could not be cloned." The page here is Node's own global, and structuredClone
 * stands in for the trip out of it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { awaited } = require('../tools/sim/answer.js');

// eval in this module's scope stands in for the page: the expressions read globalThis
const inPage = (expr) => (0, eval)(awaited(expr));

test('an element carrying React state comes out of a wait as whether it was there', async () => {
  // what React leaves on every element it draws: its fiber, with functions in it
  globalThis.simElement = { __reactFiber$x: { memoizedProps: { onClick: () => {} } } };
  assert.throws(() => structuredClone(globalThis.simElement), 'the element itself does not clone');
  const v = await inPage('globalThis.simElement');
  assert.equal(v, true);
  assert.doesNotThrow(() => structuredClone(v));
  delete globalThis.simElement;
});

test('an answer that clones comes back as it is, whether a value or a call into the app', async () => {
  assert.deepEqual(await inPage(`({ state: 'waiting', paks: [1, 2] })`), { state: 'waiting', paks: [1, 2] });
  assert.equal(await inPage(`Promise.resolve('asked')`), 'asked');
  assert.equal(await inPage(`[3, 4].indexOf(4) + 1`), 2);
});

test('nothing there, and an expression that throws, are both not yet', async () => {
  assert.equal(await inPage('null'), null);
  assert.equal(await inPage('undefined'), undefined);
  assert.equal(await inPage(`Promise.reject(new Error('gone'))`), null);
  assert.equal(await inPage('globalThis.noSuchThing.inside'), null);
});

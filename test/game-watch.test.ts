/* src/game-watch.ts: the window hears when Dota opens and closes, once per change. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createGameWatch } from '../src/game-watch.ts';

test('the answer is told the first time, and then only when it changes', async () => {
  const answers = [false, false, true, true, false];
  const told: boolean[] = [];
  const watch = createGameWatch({ isRunning: async () => answers.shift() ?? false, send: (v) => told.push(v) });
  for (let i = 0; i < 5; i++) await watch.check();
  assert.deepEqual(told, [false, true, false]);
});

test('a failed check reads as closed, and the last answer is kept for the gate', async () => {
  const watch = createGameWatch({ isRunning: async () => true, send: () => {} });
  await watch.check();
  assert.equal(watch.running(), true);
  const broken = createGameWatch({ isRunning: () => Promise.reject(new Error('no tasklist')), send: () => {} });
  assert.equal(await broken.check(), false);
});

test('a page loaded afresh hears the answer again', async () => {
  const told: boolean[] = [];
  const watch = createGameWatch({ isRunning: async () => true, send: (v) => told.push(v), everyMs: 60_000 });
  const flush = () => new Promise((r) => setImmediate(r));
  watch.start();
  await flush();
  watch.stop();
  watch.start();
  await flush();
  watch.stop();
  assert.deepEqual(told, [true, true]);
});

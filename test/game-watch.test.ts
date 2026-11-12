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

test('while the game is open it is asked every second, and a refusal asks again at once', async () => {
  let open = true;
  let asked = 0;
  const watch = createGameWatch({ isRunning: async () => { asked++; return open; }, send: () => {}, everyMs: 60_000, openMs: 20 });
  watch.start();
  // four asks take 60 ms on an idle machine; a busy Windows runner's timers can take a few times that
  const started = Date.now();
  while (asked < 4 && Date.now() - started < 2000) await new Promise((r) => setTimeout(r, 10));
  assert.ok(asked >= 4, `asked ${asked} times in ${Date.now() - started} ms`);
  open = false;
  assert.equal(watch.running(), true, 'the gate reads the last answer');
  await new Promise((r) => setImmediate(r));
  assert.equal(watch.running(), false, 'and the check it set off has the new one');
  const before = asked;
  await new Promise((r) => setTimeout(r, 80));
  watch.stop();
  assert.ok(asked <= before + 1, 'closed: the timer already set may ask once more, then every minute');
});

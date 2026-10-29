/* When the window asking for support opens on its own (src/support-prompt.ts).
 *
 * The rule is a promise to the user as much as to the project: not before the third launch,
 * a week between reminders, three reminders at most, and never again after they helped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { choose, counted, due, readPrompt, FIRST_LAUNCH, MAX_REMINDERS, SNOOZE_MS } from '../src/support-prompt.ts';

const NOW = 1_800_000_000_000;
const launches = (n: number) => {
  let p = readPrompt(undefined);
  for (let i = 0; i < n; i++) p = counted(p);
  return p;
};

test('not on the first two launches, then on the third', () => {
  assert.equal(FIRST_LAUNCH, 3);
  assert.equal(due(launches(1), NOW), false);
  assert.equal(due(launches(2), NOW), false);
  assert.equal(due(launches(3), NOW), true);
});

test('"later" puts it away for a week', () => {
  const p = choose(launches(3), 'later', NOW);
  assert.equal(due(counted(p), NOW + SNOOZE_MS - 1), false);
  assert.equal(due(counted(p), NOW + SNOOZE_MS), true);
});

test('three reminders at most, then it only opens from Settings', () => {
  let p = launches(3);
  let t = NOW;
  let shown = 0;
  for (let i = 0; i < 10; i++) {
    if (!due(p, t)) break;
    shown++;
    p = choose(p, 'later', t);
    t += SNOOZE_MS;
  }
  assert.equal(shown, 1 + MAX_REMINDERS, 'the first time, and three reminders');
  assert.equal(p.state, 'done');
  assert.equal(due(p, t + 100 * SNOOZE_MS), false);
});

test('after "done" it never opens on its own again', () => {
  const p = choose(launches(3), 'done', NOW);
  assert.equal(due(p, NOW), false);
  assert.equal(due(counted(p), NOW + 1000 * SNOOZE_MS), false);
});

test('a missing or hand-edited value starts fresh rather than breaking', () => {
  assert.deepEqual(readPrompt(null), { launches: 0, state: 'new', until: 0, later: 0 });
  assert.deepEqual(readPrompt('x'), { launches: 0, state: 'new', until: 0, later: 0 });
  assert.deepEqual(readPrompt({ launches: -4, state: 'nope', until: 'soon', later: NaN }), { launches: 0, state: 'new', until: 0, later: 0 });
  assert.deepEqual(readPrompt({ launches: 5, state: 'done', until: 7, later: 2 }), { launches: 5, state: 'done', until: 7, later: 2 });
});

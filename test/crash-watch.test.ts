/* Dota closing seconds after Play (src/crash-watch.ts).
 *
 * The promise: a run under a minute after the app's Play button is told, with the enabled mods
 * installed since the last run of a minute or more; a run started elsewhere is never told; a run
 * that lasts becomes the new point to compare against. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCrashWatch } from '../src/crash-watch.ts';

function stand(mods: { id: string; name: string; enabled?: boolean; installedAt?: number }[] = [], lastGood: number | null = null) {
  let t = 0;
  let good = lastGood;
  const w = createCrashWatch({ lastGood: () => good, setLastGood: (at) => { good = at; }, mods: () => mods, now: () => t });
  return { w, at: (ms: number) => { t = ms; }, good: () => good };
}

test('Dota closing seconds after Play names the mods put in since the last normal game', () => {
  const s = stand([
    { id: 'old', name: 'Old HUD', installedAt: 100 },
    { id: 'new', name: 'New Arcana', installedAt: 5000 },
    { id: 'off', name: 'Switched off', installedAt: 6000, enabled: false },
  ], 1000);
  s.at(10_000); s.w.launched();
  s.at(30_000); assert.equal(s.w.running(true), null);
  s.at(42_000);
  assert.deepEqual(s.w.running(false), { seconds: 12, suspects: [{ id: 'new', name: 'New Arcana' }] });
  assert.equal(s.good(), 1000, 'a crash is not a normal game');
});

test('a game that lasts is the new mark, and a quick exit without Play or without a mark says only what it knows', () => {
  const s = stand([{ id: 'a', name: 'A', installedAt: 50 }]);
  s.at(0); s.w.running(true);
  s.at(20_000);
  assert.equal(s.w.running(false), null, 'started from Steam: the app cannot tell a crash from a quit');

  s.at(30_000); s.w.launched();
  s.at(31_000); s.w.running(true);
  s.at(40_000);
  assert.deepEqual(s.w.running(false), { seconds: 9, suspects: [] }, 'no normal game yet: nothing to compare against');

  s.at(50_000); s.w.running(true);
  s.at(200_000);
  assert.equal(s.w.running(false), null);
  assert.equal(s.good(), 200_000);

  s.at(300_000); s.w.launched();
  s.at(300_000 + 6 * 60_000); s.w.running(true);
  s.at(300_000 + 6 * 60_000 + 5000);
  assert.equal(s.w.running(false), null, 'a start long after Play was not that Play');
  assert.equal(s.w.running(false), null, 'a close with no start seen says nothing');
});

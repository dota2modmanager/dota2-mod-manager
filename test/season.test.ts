/* The hunt's reward wears the same look on the site and in the window, and the site's early line
 * in the head (site/src/lib/inline-scripts.ts EARLY_LOOK) agrees with both, on every day of a year.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS as SITE, lookOn as siteLook } from '../site/src/scripts/look.ts';
import { EVENTS as APP, lookOn as appLook } from '../renderer/ui/season.ts';
import { EARLY_LOOK } from '../site/src/lib/inline-scripts.ts';

/** What the early line puts on <html> for a day, run against a stand-in page. */
function early(date: Date, store: Record<string, string>): string[] {
  const classes: string[] = [];
  const RealDate = Date;
  const FakeDate = function () { return new RealDate(date); } as unknown as DateConstructor;
  const run = new Function('localStorage', 'document', 'Date', EARLY_LOOK);
  run({ getItem: (k: string) => store[k] ?? null }, { documentElement: { classList: { add: (c: string) => classes.push(c) } } }, FakeDate);
  return classes;
}

test('the site and the window keep one table of events', () => {
  assert.deepEqual(SITE, APP);
});

test('every day of a year, the site, the window and the early line agree on the look', () => {
  for (let d = new Date(2027, 0, 1); d.getFullYear() === 2027; d = new Date(d.getTime() + 86_400_000)) {
    const look = siteLook(d);
    assert.equal(appLook(d), look, d.toDateString());
    assert.deepEqual(early(d, { 'mm-rainbow': '1' }), [look], d.toDateString());
  }
  assert.equal(siteLook(new Date(2027, 9, 31)), 'halloween');
  assert.equal(siteLook(new Date(2027, 6, 1)), 'rainbow');
});

test('the early line puts nothing on before the reward is earned, and obeys mm-look', () => {
  const day = new Date(2027, 6, 1);
  assert.deepEqual(early(day, {}), []);
  assert.deepEqual(early(day, { 'mm-rainbow': '0' }), []);
  assert.deepEqual(early(day, { 'mm-rainbow': '1', 'mm-look': 'halloween' }), ['halloween']);
});

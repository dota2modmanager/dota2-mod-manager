/**
 * The look of the day, held together in the three places that decide it: scripts/look.ts, the
 * line in the head that puts it on before the first paint (lib/inline-scripts.ts EARLY_LOOK), and
 * the app's own table (renderer/ui/season.ts). An event put away (`off`) is away in all three.
 *
 * Needs no build: node --test test/look.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EVENTS, eventDays, lookOn } from '../src/scripts/look.ts';
import { EARLY_LOOK, EVENT_DAYS } from '../src/lib/inline-scripts.ts';
import * as app from '../../renderer/ui/season.ts';

/** What EARLY_LOOK puts on <html> on a given day, with the reward earned and no `mm-look`. */
function early(date) {
  const added = [];
  const store = { 'mm-rainbow': '1' };
  const RealDate = Date;
  vm.runInNewContext(EARLY_LOOK, {
    localStorage: { getItem: (k) => store[k] ?? null },
    Date: class extends RealDate { constructor() { super(date.getTime()); } },
    document: { documentElement: { classList: { add: (c) => added.push(c) } } },
  });
  return added[0];
}

test('the line in the head knows the same events as look.ts', () => {
  assert.deepEqual(EVENT_DAYS, eventDays());
});

test('every day of a year wears the same look in the head, on the page and in the app', () => {
  for (let d = new Date(2027, 0, 1); d.getFullYear() === 2027; d.setDate(d.getDate() + 1)) {
    const day = new Date(d);
    assert.equal(early(day), lookOn(day), day.toDateString());
    assert.equal(app.lookOn(day), lookOn(day), day.toDateString());
  }
});

test('the site and the app keep one table of events', () => {
  assert.deepEqual(app.EVENTS, EVENTS);
});

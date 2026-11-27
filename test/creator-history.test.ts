import test from 'node:test';
import assert from 'node:assert/strict';

import { ago, countStates, filterItems, newestFirst, stateOf } from '../renderer/creator/history.ts';

test('a state the worker does not name yet reads as moderation', () => {
  assert.equal(stateOf({ status: 'Accepted' }), 'accepted');
  assert.equal(stateOf({ status: 'rejected' }), 'rejected');
  assert.equal(stateOf({ status: 'queued' }), 'moderation');
  assert.equal(stateOf({}), 'moderation');
});

test('the counts and the filter agree with each other', () => {
  const items = [{ status: 'accepted' }, { status: 'rejected' }, {}, { status: 'accepted' }];
  assert.deepEqual(countStates(items), { all: 4, moderation: 1, accepted: 2, rejected: 1 });
  assert.equal(filterItems(items, 'accepted').length, 2);
  assert.equal(filterItems(items, 'all'), items);
  assert.deepEqual(countStates([]), { all: 0, moderation: 0, accepted: 0, rejected: 0 });
});

test('newest first, and a submission without a date keeps its place at the end', () => {
  const a = { name: 'a', createdAt: '2026-11-01T10:00:00Z' };
  const b = { name: 'b', createdAt: '2026-11-20T10:00:00Z' };
  const c = { name: 'c' };
  const d = { name: 'd', createdAt: 'not a date' };
  assert.deepEqual(newestFirst([a, c, b, d]).map((x) => x.name), ['b', 'a', 'c', 'd']);
});

test('how long ago, in the largest whole unit', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  assert.deepEqual(ago('2026-11-27T11:59:40Z', now), { n: 0, unit: 'now' });
  assert.deepEqual(ago('2026-11-27T11:15:00Z', now), { n: 45, unit: 'min' });
  assert.deepEqual(ago('2026-11-27T07:00:00Z', now), { n: 5, unit: 'hour' });
  assert.deepEqual(ago('2026-11-20T12:00:00Z', now), { n: 7, unit: 'day' });
  assert.deepEqual(ago('2026-08-01T12:00:00Z', now), { n: 3, unit: 'month' });
  assert.equal(ago(undefined, now), null);
  assert.deepEqual(ago('2026-11-28T12:00:00Z', now), { n: 0, unit: 'now' }, 'a clock ahead is not the future');
});

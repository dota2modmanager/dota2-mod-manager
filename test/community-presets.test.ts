// The community presets' search, sorts and votes (renderer/presets/community.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, matches, needsTable, nextVote, rank, rating, revote } from '../renderer/presets/community.ts';

const card = (id: string, up: number, down: number, created: string, text = id, table = false) => ({ id, up, down, created, haystack: fold(text), table });

test('a handful of likes does not outrank a preset hundreds liked', () => {
  assert.equal(rating(0, 0), 0);
  assert.ok(rating(1, 0) < rating(200, 3), 'one vote is not proof');
  assert.ok(rating(10, 0) > rating(10, 5));
  assert.ok(rating(5, 0) > 0 && rating(5, 0) < 1);
});

test('every word of a search has to be somewhere in the card, in either case and with ё as е', () => {
  const c = card('x', 0, 0, '', 'Мой билд Ёлка · Alice · Pudge Arcana · Flat Terrain');
  assert.ok(matches(c, 'pudge'));
  assert.ok(matches(c, 'ARCANA pudge'));
  assert.ok(matches(c, 'елка'));
  assert.ok(matches(c, '  '));
  assert.ok(!matches(c, 'pudge invoker'));
});

test('each sort puts the cards in its order and the search leaves only what matches', () => {
  const cards = [
    card('old-loved', 200, 3, '2026-10-01', 'pudge'),
    card('new-one', 1, 0, '2026-11-20', 'pudge'),
    card('mixed', 250, 120, '2026-11-01', 'invoker'),
  ];
  assert.deepEqual(rank(cards, '', 'new').map((c) => c.id), ['new-one', 'mixed', 'old-loved']);
  assert.deepEqual(rank(cards, '', 'liked').map((c) => c.id), ['mixed', 'old-loved', 'new-one']);
  assert.deepEqual(rank(cards, '', 'top').map((c) => c.id), ['old-loved', 'mixed', 'new-one']);
  assert.deepEqual(rank(cards, 'pudge', 'top').map((c) => c.id), ['old-loved', 'new-one']);
  assert.equal(cards[0].id, 'old-loved', 'the list given is left as it was');
});

test('the item table filter keeps the presets that need items_game apart from those that do not', () => {
  assert.equal(needsTable(['item:centaur:weapon', 'item:axe:head']), false);
  assert.equal(needsTable(['item:axe:head', 'weather']), true);
  assert.equal(needsTable([]), false);
  const cards = [card('files', 1, 0, '2026-11-01', 'x', false), card('table', 1, 0, '2026-11-02', 'x', true)];
  assert.deepEqual(rank(cards, '', 'new', 'all').map((c) => c.id), ['table', 'files']);
  assert.deepEqual(rank(cards, '', 'new', 'files').map((c) => c.id), ['files']);
  assert.deepEqual(rank(cards, '', 'new', 'table').map((c) => c.id), ['table']);
});

test('a vote moves the counts at once, and the same thumb again takes it back', () => {
  assert.deepEqual(revote({ up: 3, down: 1 }, 0, 1), { up: 4, down: 1 });
  assert.deepEqual(revote({ up: 3, down: 1 }, 1, -1), { up: 2, down: 2 });
  assert.deepEqual(revote({ up: 0, down: 0 }, 1, 0), { up: 0, down: 0 });
  assert.equal(nextVote(0, 1), 1);
  assert.equal(nextVote(1, 1), 0);
  assert.equal(nextVote(1, -1), -1);
});

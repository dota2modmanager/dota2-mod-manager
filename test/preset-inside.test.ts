// What a preset holds, sorted for reading (renderer/presets/inside.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { heroItem, sortInside, tokenName } from '../renderer/presets/inside.ts';

test("a hero's items go under the hero, top of the body first, and the rest by category", () => {
  const s = sortInside([
    { kind: 'mod', categoryId: 'trees', data: 'Crate Trees' },
    { kind: 'look', slot: 'item:centaur:weapon', data: 'Axe' },
    { kind: 'look', slot: 'item:earth_spirit:head', data: 'Helm' },
    { kind: 'look', slot: 'item:centaur:head', data: 'Hat' },
    { kind: 'look', slot: 'item:centaur:tail', data: 'Tail' },
    { kind: 'look', slot: 'weather', data: 'Rain' },
    { kind: 'mod', categoryId: 'trees', data: 'Pumpkin Trees' },
  ], (slot) => `cosmetic:${slot}`);
  assert.deepEqual(s.groups, [{ id: 'trees', entries: ['Crate Trees', 'Pumpkin Trees'] }, { id: 'cosmetic:weather', entries: ['Rain'] }]);
  assert.deepEqual(s.heroes.map((h) => [h.hero, h.entries.map((e) => e.data)]), [['centaur', ['Hat', 'Axe', 'Tail']], ['earth_spirit', ['Helm']]]);
});

test('only item:<hero>:<slot> is a hero item, and a token reads as a name', () => {
  assert.deepEqual(heroItem('item:queenofpain:head'), { hero: 'queenofpain', slot: 'head' });
  assert.equal(heroItem('weather'), null);
  assert.equal(heroItem('item:'), null);
  assert.equal(tokenName('earth_spirit'), 'Earth Spirit');
});

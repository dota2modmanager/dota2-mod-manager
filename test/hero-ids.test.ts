// A catalog hero's game id (renderer/catalog/hero-ids.ts): the key that puts the heroes category in
// the game's four attribute columns. The names are the catalog's own and the item table's own, as
// the sandbox had them on 2026-11-14, where 125 of 128 matched by name alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { heroIdOf, heroIdsByName } from '../renderer/catalog/hero-ids.ts';

const SLOTS = [
  { heroLabel: 'Anti-Mage', heroIds: ['antimage'] },
  { heroLabel: "Nature's Prophet", heroIds: ['furion'] },
  { heroLabel: 'Centaur Warrunner', heroIds: ['centaur'] },
  { heroLabel: 'Queen of Pain', heroIds: ['queenofpain'] },
  { heroLabel: 'Queen of Pain', heroIds: ['queenofpain'] },
  { heroIds: ['nobody'] },
];

test('a catalog name finds its hero by letters, whatever the punctuation', () => {
  const ids = heroIdsByName(SLOTS);
  assert.equal(heroIdOf('Anti-Mage', ids), 'antimage');
  assert.equal(heroIdOf('Natures Prophet', ids), 'furion');
  assert.equal(heroIdOf('Queen Of Pain', ids), 'queenofpain');
});

test('the one name the catalog shortens still finds its hero', () => {
  assert.equal(heroIdOf('Centaur', heroIdsByName(SLOTS)), 'centaur');
});

test('a hero newer than the slots is found through the attributes, and an unknown one is not', () => {
  const ids = heroIdsByName(SLOTS);
  assert.equal(heroIdOf('Kez', ids, { kez: 'agi' }), 'kez');
  assert.equal(heroIdOf('Largo', ids, { kez: 'agi' }), '');
  assert.equal(heroIdOf('', ids), '');
});

/* Which heroes the hero field of the look on everybody offers for what was typed
 * (renderer/settings/hero-suggest.ts): 122 heroes built made a list to scroll, so the user types. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { heroSuggestions } from '../renderer/settings/hero-suggest.ts';

const built = [
  { id: 'tusk', name: 'Tusk' }, { id: 'skywrath_mage', name: 'Skywrath Mage' }, { id: 'furion', name: "Nature's Prophet" },
  { id: 'death_prophet', name: 'Death Prophet' }, { id: 'axe', name: 'Axe' }, { id: 'sand_king', name: 'Sand King' },
];

test('a name that starts with what was typed comes first, then one with a word that does, then any', () => {
  assert.deepEqual(heroSuggestions(built, [], 'sk').map((h) => h.id), ['skywrath_mage', 'tusk']);
  assert.deepEqual(heroSuggestions(built, [], 'pro').map((h) => h.id), ['death_prophet', 'furion'], 'both at a word, then by name');
  assert.deepEqual(heroSuggestions(built, [], 'KING').map((h) => h.id), ['sand_king'], 'any case');
});

test('nothing for an empty field, never a hero already chosen, and no more than asked', () => {
  assert.deepEqual(heroSuggestions(built, [], '   '), []);
  assert.deepEqual(heroSuggestions(built, ['skywrath_mage'], 'sk').map((h) => h.id), ['tusk']);
  assert.equal(heroSuggestions(built, [], 'a', 2).length, 2);
});

test('in Chinese the shown name is matched as well as the English one', () => {
  assert.deepEqual(heroSuggestions([{ id: 'axe', name: 'Axe' }], [], '斧王', 8, 'zh-CN').map((h) => h.id), ['axe']);
});

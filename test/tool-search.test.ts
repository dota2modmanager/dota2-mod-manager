/* What a catalog search puts above the mods (renderer/catalog/screen/tool-search.ts). Players asked
 * on Discord for weather and for a way to publish their own mod, both of which the app had, because
 * a search for the word found no mod and nothing else. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { toolsForSearch } from '../renderer/catalog/screen/tool-search.ts';

test('a search for weather leads with the map of one\'s own', () => {
  for (const q of ['погода', 'Дождь', 'снег на карте', 'тёмная карта с дождём', 'weather', 'Rain']) {
    assert.deepEqual(toolsForSearch(q), ['map'], q);
  }
});

test('a search for a mod of one\'s own leads with the author\'s desk', () => {
  for (const q of ['как выложить свой мод', 'загрузить мод', 'опубликовать', 'кабинет автора', 'upload my mod']) {
    assert.ok(toolsForSearch(q).includes('creator'), q);
  }
});

test('a background of one\'s own leads with both: the menu background, and the way into the catalog', () => {
  assert.deepEqual(toolsForSearch('как закинуть свой фон'), ['background', 'creator']);
  assert.deepEqual(toolsForSearch('фон'), ['background']);
});

test('a word inside another word is not a match, and neither is a short query', () => {
  assert.deepEqual(toolsForSearch('телефон'), []);
  assert.deepEqual(toolsForSearch('Pudge'), []);
  assert.deepEqual(toolsForSearch('сн'), []);
  assert.deepEqual(toolsForSearch(''), []);
});

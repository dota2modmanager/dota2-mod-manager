// The catalog adds categories on its own schedule. One this app has no place for still has to
// show up, under the rail's last section, or its mods can only be found by searching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railSections } from '../renderer/catalog/rail-sections.ts';

test('a category the app knows sits in its own section, and only the ones the catalog has', () => {
  const s = railSections(['heroes', 'terrains', 'hero-icons', 'neutral-creeps']);
  assert.deepEqual(s, [['Герои', ['heroes']], ['Мир', ['terrains', 'neutral-creeps']], ['Интерфейс', ['hero-icons']]]);
});

test('a category the app has never heard of goes under the last section, and news nowhere', () => {
  const s = railSections(['heroes', 'tools', 'brand-new', 'news']);
  assert.deepEqual(s.at(-1), ['Прочее', ['tools', 'brand-new']]);
  assert.ok(!s.flatMap(([, ids]) => ids).includes('news'));
});

test('an unknown category gets a section even when the last section has nothing of its own', () => {
  assert.deepEqual(railSections(['brand-new']), [['Прочее', ['brand-new']]]);
});

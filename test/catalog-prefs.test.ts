/* The catalog's author filter (renderer/catalog/filters.ts) and what the catalog remembers of how
 * you look at it (renderer/catalog/prefs.ts).
 *
 * The promise: picking an author shows that author's mods, however the catalog spelled the name; an
 * author picked in one category never empties another; and the sort, the author, the two chips and
 * the search come back after a restart, while a stored value the window cannot use is its default. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFilters, authorIn, collectAuthors, modAuthors } from '../renderer/catalog/filters.ts';
import { readPrefs, rememberedOf, startingFilters, writePrefs } from '../renderer/catalog/prefs.ts';
import type { Filters, Mod } from '../renderer/catalog/types.ts';

const fresh = (): Filters => ({ sort: 'default', tags: new Set(), installedOnly: false, favOnly: false, group: '', hero: '', slot: '', author: '' });
const none = { isInstalled: () => false, isFav: () => false, heroMatches: () => true };
const by = (type: string, url: string) => ({ type, url });
// as the catalog writes them: people in the links, a role each; a few older mods in a field
const MODS: Mod[] = [
  { name: 'Blue Hook', links: [by('author', 'h6rd'), by('source', 'https://example.com/hook')] },
  { name: 'Red Hook', links: [by('author', 'H6rd ')] },
  { name: 'Weather', links: [by('author', 'TheFleece'), by('modded', 'J0nathan550'), by('sender', 'Somebody')] },
  { name: 'Terrain', author: 'J0nathan550' },
  { name: 'Arcana', links: [by('author', 'h6rd'), by('author', 'TheFleece')] },
  { name: 'Sent In', links: [by('sender', 'Somebody')] },
  { name: 'Nobody Named' },
];
const names = (list: Mod[]) => list.map((m) => m.name);
const SORTS = ['default', 'date', 'popular', 'name', 'name-desc'];

/** Storage as the window has it, in memory. */
function memory(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
}

test("a mod's authors are whoever the catalog credits with making it, not whoever only sent it in", () => {
  assert.deepEqual(MODS.map(modAuthors), [['h6rd'], ['H6rd'], ['TheFleece', 'J0nathan550'], ['J0nathan550'], ['h6rd', 'TheFleece'], [], []]);
});

test('the authors of a list come once each, A-Z, with how many mods are theirs, however they are spelled', () => {
  assert.deepEqual(collectAuthors(MODS), [
    { name: 'h6rd', count: 3 }, { name: 'J0nathan550', count: 2 }, { name: 'TheFleece', count: 2 },
  ], 'a mod of two authors counts for both, and a modder for the mod they reworked');
  assert.deepEqual(collectAuthors([]), []);
});

test("picking an author shows that author's mods, and an author with none here narrows nothing", () => {
  assert.deepEqual(names(applyFilters(MODS, { ...fresh(), author: 'H6RD' }, none)), ['Blue Hook', 'Red Hook', 'Arcana']);
  assert.deepEqual(names(applyFilters(MODS, { ...fresh(), author: 'J0nathan550' }, none)), ['Weather', 'Terrain'], 'a modder, and the older field');
  assert.equal(authorIn(MODS, 'Somebody'), '', 'a sender is nobody to filter by');
  assert.deepEqual(names(applyFilters(MODS, { ...fresh(), author: 'Somebody Else' }, none)), names(MODS),
    'remembered from another category, it is set aside rather than emptying this one');
  assert.equal(authorIn(MODS, 'Somebody Else'), '');
  assert.equal(authorIn(MODS, 'h6rd'), 'h6rd');
  assert.equal(authorIn(MODS, ''), '');
});

test('the sort, the author, the chips and the search come back as they were left', () => {
  const store = memory();
  assert.deepEqual(readPrefs(store, SORTS), { sort: 'default', author: '', installedOnly: false, favOnly: false, search: '' }, 'nothing stored yet');
  writePrefs(store, SORTS, { sort: 'date', author: 'h6rd' });
  writePrefs(store, SORTS, { installedOnly: true, search: 'hook' });
  assert.deepEqual(readPrefs(store, SORTS), { sort: 'date', author: 'h6rd', installedOnly: true, favOnly: false, search: 'hook' }, 'a change keeps the rest');
  const start = startingFilters({ ...fresh(), hero: 'Pudge', tags: new Set(['x']) }, readPrefs(store, SORTS));
  assert.deepEqual({ ...start, tags: [...start.tags] },
    { sort: 'date', author: 'h6rd', installedOnly: true, favOnly: false, group: '', hero: 'Pudge', slot: '', tags: ['x'] },
    'the remembered parts on top of what the category starts with');
});

test('a stored value the window cannot use is its default, and a window with no storage just forgets', () => {
  const broken = memory({ catalogPrefs: '{"sort":"by-magic","author":7,"installedOnly":"yes","favOnly":true,"search":["x"]}' });
  assert.deepEqual(readPrefs(broken, SORTS), { sort: 'default', author: '', installedOnly: false, favOnly: true, search: '' });
  assert.deepEqual(readPrefs(memory({ catalogPrefs: 'not json' }), SORTS).sort, 'default');
  assert.deepEqual(readPrefs(memory({ catalogPrefs: 'null' }), SORTS).search, '');
  assert.doesNotThrow(() => writePrefs(null, SORTS, { sort: 'date' }));
  const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => writePrefs(full, SORTS, { sort: 'date' }));
});

test("only the toolbar's remembered parts are kept: a category's own hero, slot or tags are not", () => {
  assert.deepEqual(rememberedOf({ sort: 'name', hero: 'Axe' }), { sort: 'name' });
  assert.deepEqual(rememberedOf({ favOnly: false }), { favOnly: false });
  assert.equal(rememberedOf({ hero: 'Axe', slot: 'weapon' }), null);
});

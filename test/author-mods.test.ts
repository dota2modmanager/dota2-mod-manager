import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorMods } from '../renderer/catalog/author-mods.ts';
import type { Mod } from '../renderer/catalog/types.ts';

const mod = (name: string, date: number, links: { type: string; url: string }[]) => ({ name, meta: { date }, links }) as unknown as Mod;

test("an author's page has their mods from every category, a modder's work too, newest first", () => {
  const cats: [string, Mod[]][] = [
    ['heroes', [mod('Pudge Red', 10, [{ type: 'author', url: 'hrdq' }]), mod('Other', 50, [{ type: 'author', url: 'someone' }])]],
    ['emblems', [mod('Blue Ring', 30, [{ type: 'author', url: 'HRDQ' }])]],
    ['huds', [mod('Reworked', 20, [{ type: 'author', url: 'someone' }, { type: 'modded', url: 'hrdq' }])]],
    ['sounds', [mod('Sent', 40, [{ type: 'sender', url: 'hrdq' }])]],
  ];
  assert.deepEqual(authorMods('hrdq', cats).map((m) => [m._cat, m.name]), [
    ['emblems', 'Blue Ring'], ['huds', 'Reworked'], ['heroes', 'Pudge Red'],
  ]);
  assert.deepEqual(authorMods('nobody', cats), []);
});

test('a mod the catalog lists in two categories is counted once', () => {
  const m = mod('Both', 1, [{ type: 'author', url: 'hrdq' }]);
  assert.deepEqual(authorMods('hrdq', [['heroes', [m]], ['packs', [m]]]).map((x) => x._cat), ['heroes']);
});

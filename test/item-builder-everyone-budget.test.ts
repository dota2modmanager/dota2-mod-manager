/* How much of the look on everybody the game can take (src/item-builder-everyone-budget.ts).
 * Written after #414: 9,706 paths of it in one library made Skywrath Mage's projectiles fly with
 * other heroes' hands and chests on them, and 5,464 did not. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { withinBudget, heroesByRecency, EVERYONE_ENTRY_BUDGET } from '../src/item-builder-everyone-budget.ts';
import type { EveryonePatch } from '../src/item-builder-everyone.ts';
import { entryAt, entryPath } from '../src/vpk.ts';

const model = Buffer.from('the user\'s model');
/** A hero's dressed items, `n` of them, each one path under models/items/<hero>/. */
function dressed(hero: string, n: number, first = 0): EveryonePatch[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${hero}-${first + i}`, block: '', source: `${hero}'s Weapon: everybody's`, hero: `npc_dota_hero_${hero}`,
    assets: [entryAt(`models/items/${hero}/item_${first + i}.vmdl_c`, model)],
  }));
}
const heroesOf = (patches: EveryonePatch[]) => [...new Set(patches.map((p) => p.hero.replace('npc_dota_hero_', '')))];
const none = { patches: [], beneath: [] };

test('the heroes of the picks, the one picked most lately first, and none twice', () => {
  assert.deepEqual(heroesByRecency([
    { slot: 'item:axe:weapon', installedAt: 10 },
    { slot: 'item:skywrath_mage:back', installedAt: 30 },
    { slot: 'item:axe:head', installedAt: 40 },
    { slot: 'item:pudge:weapon', installedAt: 50, enabled: false },
    { slot: 'hero:juggernaut' },
    {},
  ]), ['axe', 'skywrath_mage'], 'a switched-off pick and a record that is no pick count for nothing');
});

test('heroes go in whole, in order, while the pak stays under the budget, and the rest are named', () => {
  const all = [...dressed('axe', 40), ...dressed('pudge', 30), ...dressed('lina', 20)];
  // the table itself is one entry: 1 + 40 + 30 = 71 fits a budget of 80, 20 more does not, 10 would
  const { patches, left } = withinBudget(all, none, ['axe', 'lina', 'pudge'], 80);
  assert.deepEqual(heroesOf(patches), ['axe', 'lina'], 'in the order asked');
  assert.deepEqual(left, ['pudge'], 'the one that did not fit is said, not dropped in silence');
  assert.equal(patches.length, 60, 'every item of a hero taken, never half of one');
});

test("the build's own files count against the budget, and a path two heroes share counts once", () => {
  const own = { patches: [{ id: '1', block: '', assets: Array.from({ length: 50 }, (_, i) => entryAt(`models/heroes/axe/own_${i}.vmdl_c`, model)) }], beneath: [] };
  const all = [...dressed('axe', 30), ...dressed('lina', 30)];
  assert.deepEqual(withinBudget(all, own, ['axe', 'lina'], 100).left, ['lina'], '1 + 50 + 30 leaves no room for 30 more');
  // lina's items under axe's paths: nothing new to add, so she fits however full the pak is
  const shared = dressed('lina', 30).map((p, i) => ({ ...p, assets: [entryAt(`models/items/axe/item_${i}.vmdl_c`, model)] }));
  assert.deepEqual(withinBudget([...dressed('axe', 30), ...shared], own, ['axe', 'lina'], 100).left, []);
});

test('a hero the order does not name comes last, and the budget is below what was seen to break', () => {
  const { patches } = withinBudget([...dressed('axe', 5), ...dressed('pudge', 5)], none, ['pudge']);
  assert.deepEqual(heroesOf(patches), ['pudge', 'axe']);
  assert.ok(EVERYONE_ENTRY_BUDGET < 5462, 'under the largest count seen working (#414)');
  assert.ok(entryPath(patches[0].assets![0]).startsWith('models/items/pudge/'));
});

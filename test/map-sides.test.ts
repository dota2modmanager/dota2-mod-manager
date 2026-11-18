// Which side a pick of the game's tree or tower sets goes on in "Своя карта" (renderer/catalog/decor/sides.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickedOf, sidesFor } from '../renderer/catalog/decor/sides.ts';

const both = { id: 'spring', name: 'Spring', sides: ['radiant', 'dire'] as ('radiant' | 'dire')[], models: { radiant: 'r.vmdl', dire: 'd.vmdl' } };
const radiantOnly = { id: 'tower_r', name: 'Radiant Towers', sides: ['radiant'] as ('radiant' | 'dire')[], models: { radiant: 'r.vmdl' } };
const none = { radiant: null, dire: null };

test('a set picked for both sides goes on every side it has', () => {
  assert.deepEqual(sidesFor(both, 'both', none), { radiant: 'spring', dire: 'spring' });
  assert.deepEqual(sidesFor(radiantOnly, 'both', { radiant: null, dire: 'x' }), { radiant: 'tower_r', dire: null });
  assert.deepEqual(sidesFor(undefined, 'both', { radiant: 'a', dire: 'b' }), none);
});

test('a set picked for one side leaves the other as it was', () => {
  assert.deepEqual(sidesFor(both, 'dire', { radiant: 'autumn', dire: null }), { radiant: 'autumn', dire: 'spring' });
  assert.deepEqual(sidesFor(radiantOnly, 'dire', { radiant: 'autumn', dire: 'x' }), { radiant: 'autumn', dire: null });
  assert.deepEqual(sidesFor(undefined, 'radiant', { radiant: 'a', dire: 'b' }), { radiant: null, dire: 'b' });
});

test('on both sides a tile reads as picked only when both sides share it', () => {
  assert.equal(pickedOf({ radiant: 'a', dire: 'a' }, 'both'), 'a');
  assert.equal(pickedOf({ radiant: 'a', dire: 'b' }, 'both'), null);
  assert.equal(pickedOf({ radiant: 'a', dire: 'b' }, 'dire'), 'b');
  assert.equal(pickedOf(undefined, 'radiant'), null);
});

test('for both sides a tower look is one tile, its Radiant set on Radiant and its Dire set on Dire', async () => {
  const { bothSides, onePerName, pickedBoth } = await import('../renderer/catalog/decor/sides.ts');
  const name = (o: { name: string }) => o.name.replace(/\s*-?\s*(Radiant|Dire) Towers$/i, '');
  const r = { id: 'g_r', name: 'Grasp - Radiant Towers', sides: ['radiant'] as ('radiant' | 'dire')[], models: { radiant: 'r.vmdl' } };
  const d = { id: 'g_d', name: 'Grasp - Dire Towers', sides: ['dire'] as ('radiant' | 'dire')[], models: { dire: 'd.vmdl' } };
  const fx = { id: 'fx', name: 'Event Building Effects', sides: ['radiant', 'dire'] as ('radiant' | 'dire')[], models: { radiant: 'a', dire: 'b' } };
  const sets = [r, d, fx];
  assert.deepEqual(onePerName(sets, name).map((o) => o.id), ['g_r', 'fx']);
  assert.deepEqual(bothSides(sets, name, 'g_r'), { radiant: 'g_r', dire: 'g_d' });
  assert.equal(pickedBoth(sets, name, { radiant: 'g_r', dire: 'g_d' }), 'g_r');
  assert.equal(pickedBoth(sets, name, { radiant: 'g_r', dire: null }), null);
  assert.equal(pickedBoth(sets, name, { radiant: 'fx', dire: 'fx' }), 'fx');
});

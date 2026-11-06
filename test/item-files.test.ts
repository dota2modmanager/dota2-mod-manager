/* A pick read for what its files must carry and what only the table can do (src/item-files.ts). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extraPlaces, pickParts } from '../src/item-files.ts';

const block = (visuals: string) => `"100"\n{\n\t"name"\t"x"\n\t"visuals"\n\t{\n${visuals}\n\t}\n}\n`;
const mod = (type: string, modifier: string, extra = '') => `"asset_modifier"\n{\n"type"\t"${type}"\n"modifier"\t"${modifier}"\n${extra}\n}\n`;

test('an effect goes on the model that is worn', () => {
  const p = pickParts({ block: block(mod('particle_create', 'particles/a.vpcf')), own: 'models/x.vmdl_c' });
  assert.deepEqual(p.systems, ['particles/a.vpcf']);
  assert.deepEqual(p.left, []);
});

test('an effect with no model of the pick to ride on is left behind', () => {
  const p = pickParts({ block: block(mod('particle_create', 'particles/a.vpcf')), own: null });
  assert.deepEqual(p.left, ['its effect']);
});

test('a second style\'s entries are not the pick\'s', () => {
  const p = pickParts({ block: block(mod('particle_create', 'particles/b.vpcf', '"style"\t"1"')), own: 'm' });
  assert.deepEqual(p.systems, []);
});

test('motions, a material set and what only the table does', () => {
  const p = pickParts({
    block: block(`${mod('activity', 'axe_blackthorn')}"asset_modifier"\n{\n"type"\t"model_skin"\n"skin"\t"2"\n}\n${mod('pet', 'x')}`),
    own: 'm',
  });
  assert.deepEqual(p.motions, ['axe_blackthorn']);
  assert.equal(p.skin, 2);
  assert.deepEqual(p.left, ['its pet']);
});

test('a pick\'s second model takes the stock one\'s path, and with none that path goes empty', () => {
  assert.deepEqual(extraPlaces(['s.vmdl'], ['a.vmdl']), { under: [{ path: 's.vmdl', model: 'a.vmdl' }], merged: [] });
  assert.deepEqual(extraPlaces(['s.vmdl'], []), { under: [{ path: 's.vmdl', model: null }], merged: [] });
});

test('a second model the stock item has no path for goes inside the first', () => {
  assert.deepEqual(extraPlaces([], ['a.vmdl']), { under: [], merged: ['a.vmdl'] });
  assert.deepEqual(extraPlaces(['s.vmdl'], ['a.vmdl', 'b.vmdl']), { under: [{ path: 's.vmdl', model: 'a.vmdl' }], merged: ['b.vmdl'] });
});

test('the stock second model kept by a pick stays as it is', () => {
  assert.deepEqual(extraPlaces(['s.vmdl'], ['s.vmdl']), { under: [], merged: [] });
});

test('a slot with no stock model loses the model', () => {
  assert.deepEqual(pickParts({ block: block(''), own: null, unplaced: true }).left, ['its model']);
});

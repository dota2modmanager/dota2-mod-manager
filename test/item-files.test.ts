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

test('a body group goes onto the arcana base\'s body, not the game\'s plain one', async () => {
  // Terrorblade's arcana from the builder: his body read from the game first took the base's place
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { buildVpk, entryAt, entryPath } = await import('../src/vpk.ts');
  const { itemFilesSteps } = await import('../src/item-files.ts');
  const { drain } = await import('../src/steps.ts');
  const { resourceBlock } = await import('../src/resource.ts');
  const { encodeKv3, resource, rerl } = await import('./helpers/kv3-build.ts');
  const model = (tag: string) => resource([['RERL', rerl([])], ['DATA', encodeKv3({ obj: [
    ['m_name', { str: tag }], ['m_meshGroups', { arr: [{ str: 'head_@0_#&0' }, { str: 'head_@1_#&1' }] }], ['m_nDefaultMeshGroupMask', { i64: 1 }],
  ] })]]);
  const BODY = 'models/heroes/x/x.vmdl_c';
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-files-'));
  try {
    fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
    fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([entryAt(BODY, model('plain'))]));
    const patch = { id: '100', block: block(`"asset_modifier"\n{\n"type"\t"bodygroup_visibility"\n"asset"\t"models/heroes/x/x.vmdl"\n"modifier"\t"head"\n"value"\t"1"\n}\n`), assets: [], item: true, own: null };
    const { entries } = drain(itemFilesSteps([patch], [entryAt(BODY, model('base'))], game));
    const body = entries.find((e) => entryPath(e).toLowerCase() === BODY);
    assert.ok(body && resourceBlock(body.data, 'DATA').data.includes(Buffer.from('base')), "the base's body");
  } finally { fs.rmSync(game, { recursive: true, force: true }); }
});

/* The item builder's random looks (renderer/catalog/builder/random-look.ts). */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/catalog/builder/random-look.ts');
const first = () => 0;
const slot = (name, options, extra = {}) => ({ slot: `item:axe:${name}`, targetId: '1', options, ...extra });
const opt = (id, rarity, note) => ({ id, name: `Item ${id}`, rarity, ...(note ? { note: { status: note, text: '' } } : {}) });

const slots = [
  slot('head', [opt('10', 'rare'), opt('11', 'immortal')]),
  slot('weapon', [opt('20', 'arcana'), opt('21', 'common', 'broken')]),
  slot('belt', [opt('30', 'common', 'broken')]),
  slot('persona', [opt('40', 'mythical')], { persona: { hero: 'axe', part: false } }),
  slot('ability1', [opt('50', 'immortal')], { abilityFx: 1 }),
];
const worn = [{ slot: 'item:axe:head', itemId: '10', name: 'Item 10' }, { slot: 'item:axe:ability1', itemId: '50', name: 'Item 50' }];

test('fill keeps what is on and dresses only the empty body slots, never a broken item', async () => {
  const { randomPicks } = await load();
  const picks = randomPicks(slots, worn, 'fill', first);
  assert.deepEqual(picks.map((p) => [p.slot.split(':')[2], p.itemId]), [['head', '10'], ['weapon', '20'], ['ability1', '50']]);
});

test('all draws every body slot again, another item than the one on, and keeps the rest', async () => {
  const { randomPicks } = await load();
  const picks = randomPicks(slots, worn, 'all', first);
  assert.deepEqual(picks.map((p) => [p.slot.split(':')[2], p.itemId]), [['head', '11'], ['weapon', '20'], ['ability1', '50']]);
});

test('top puts on arcanas and immortals only, and says when there is nothing to change', async () => {
  const { randomPicks } = await load();
  const picks = randomPicks(slots, worn, 'top', first);
  assert.deepEqual(picks.map((p) => p.itemId), ['11', '20', '50']);
  assert.equal(randomPicks([slot('belt', [opt('30', 'common')])], [], 'top', first), null);
});

test('a random set is one that fits whole, other than the one worn', async () => {
  const { randomSet } = await load();
  const set = (id, fits) => ({ id, name: id, heroLabel: 'Axe', fit: 0, pieces: fits.map((f) => ({ slot: 's', itemId: '1', name: 'p', fits: f })) });
  const sets = [set('a', [true, true]), set('b', [true, false]), set('c', [true])];
  assert.equal(randomSet(sets, 'a', first).id, 'c');
  assert.equal(randomSet([set('a', [true])], 'a', first).id, 'a', 'the only one is still a set');
  assert.equal(randomSet([set('b', [false])], null, first), null);
});

/* Mods the catalog tags adult (renderer/core/adult.js): hidden from browsing until the user says
 * they are 18 and want them, and the one question asked only when it means something. */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = async () => ({
  adult: await import('../renderer/core/adult.js'),
  store: await import('../renderer/core/store.js'),
});

// the shape the catalog ships: an adult mod, one whose tags are all false, and one with none
const MODS = [
  { name: 'Nude Marci', tags: { adult: true } },
  { name: 'Bare Brewmaster', tags: { effects: false, icons: false } },
  { name: 'Untagged' },
];
const names = (list) => list.map((m) => m.name);

test('adult mods are hidden until the user said yes, and a no or no answer keeps them hidden', async () => {
  const { adult, store } = await load();
  for (const settings of [null, {}, { showAdult: null }, { showAdult: false }]) {
    store.state.settings = settings;
    assert.equal(adult.adultShown(), false, JSON.stringify(settings));
    assert.deepEqual(names(adult.shownMods(MODS)), ['Bare Brewmaster', 'Untagged'], JSON.stringify(settings));
  }
  store.state.settings = { showAdult: true };
  assert.equal(adult.adultShown(), true);
  assert.deepEqual(names(adult.shownMods(MODS)), names(MODS));
  assert.equal(adult.isAdult({ tags: { adult: false } }), false);
  assert.equal(adult.isAdult(null), false);
});

test('the question is asked once, and only when the catalog has an adult mod to ask about', async () => {
  const { adult, store } = await load();
  store.state.modIndex.clear();
  for (const m of MODS) store.state.modIndex.set(m.name.toLowerCase(), { categoryId: 'heroes', mod: m });
  store.state.settings = { showAdult: null };
  assert.equal(adult.adultCount(), 1);
  assert.equal(adult.adultUnanswered(), true, 'never answered, one adult mod');
  for (const answer of [true, false]) {
    store.state.settings = { showAdult: answer };
    assert.equal(adult.adultUnanswered(), false, `answered ${answer}`);
  }
  store.state.modIndex.delete('nude marci');
  store.state.settings = { showAdult: null };
  assert.equal(adult.adultUnanswered(), false, 'a catalog with nothing adult in it asks nothing');
});

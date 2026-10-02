/* The item builder's rules, out of its screen (renderer/catalog/builder/logic.ts): what the one
 * button does with what is chosen, which sets a search finds, and what a hero's card says. What a
 * pick does to the game is item-builder.test.js. Node runs the TypeScript as it is. */
const test = require('node:test');
const assert = require('node:assert/strict');

// i18n.js puts these on window before any module runs; the tests read the Russian source
globalThis.window = { I18N_LANG: 'ru' };
globalThis.tr = (s) => s;
globalThis.L = (strings, ...values) => (typeof strings === 'string'
  ? strings
  : strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), ''));

const load = () => import('../renderer/catalog/builder/logic.ts');

const effects = [{ id: '', name: 'Нет' }, { id: 'fire', name: 'Огонь' }, { id: 'snow', name: 'Снег' }, { id: 'ghost', name: 'Призрак' }];
const staged = (selectedId, effectIds = [], busy = false) => ({ selectedId, effectIds, busy });

test('the button puts on only what differs from what the game shows', async () => {
  const { stagedItemAction } = await load();
  const live = { itemId: '42', name: 'Helm', effectId: 'fire,snow' };

  assert.equal(stagedItemAction(effects, live, staged('42', ['fire'], true)).label, 'Надеваю…', 'a write in flight wins');
  assert.equal(stagedItemAction(effects, live, staged('42', ['fire'], true)).off, true);

  const back = stagedItemAction(effects, live, staged(''));
  assert.deepEqual([back.label, back.remove, back.off], ['Вернуть стандартный', true, undefined], 'the stock item takes the pick off');
  assert.equal(stagedItemAction(effects, null, staged('')).off, true, 'nothing on and the stock item chosen: nothing to do');

  assert.equal(stagedItemAction(effects, live, staged('7')).label, 'Надеть');
  assert.equal(stagedItemAction(effects, live, staged('42', ['snow', 'fire'])).off, true,
    'the same effects picked in another order are what is on already');
  assert.equal(stagedItemAction(effects, live, staged('42', ['fire'])).label, 'Сохранить эффекты');
});

test('effects are written in the order the slot offers them, and read back as a list', async () => {
  const { effectKey, liveEffects } = await load();
  assert.equal(effectKey(effects, ['ghost', 'fire', 'nope']), 'fire,ghost');
  assert.equal(effectKey(effects, []), '');
  assert.deepEqual(liveEffects({ effectId: 'fire,,snow' }), ['fire', 'snow']);
  assert.deepEqual(liveEffects(null), []);
});

test('a set is found by its own name or by a piece, and says only what tells something', async () => {
  const { matchingSets, setCardMeta, setCount, setIsOn } = await load();
  const piece = (slot, itemId, name, fits = true) => ({ slot, itemId, name, fits });
  const sets = [
    { id: 's1', name: 'Arsenal', heroLabel: 'Abaddon', fit: 2, pieces: [piece('head', '1', 'Horned Helm'), piece('back', '2', 'Cape')] },
    { id: 's2', name: 'Mantle', heroLabel: 'Abaddon', fit: 1, pieces: [piece('head', '3', 'Hood'), piece('mount', '4', 'Steed', false)] },
  ];
  assert.deepEqual(matchingSets(sets, ' helm ').map((s) => s.id), ['s1'], 'a piece\'s name finds its set');
  assert.equal(matchingSets(sets, '').length, 2);

  const on = { head: { itemId: '3' } };
  const pickedIn = (slot) => on[slot] || null;
  assert.equal(setIsOn(sets[1], pickedIn), true, 'a piece the builder cannot put on does not keep a set from being on');
  assert.equal(setIsOn(sets[0], pickedIn), false);

  assert.equal(setCardMeta(sets[0], false), ' ', 'a whole set says nothing: 1914 of 1925 fit whole');
  assert.equal(setCardMeta(sets[1], false), '1 из 2');
  assert.equal(setCardMeta(sets[1], true), 'Надето');
  assert.equal(setCount(sets[0]), '2 детали');
  assert.equal(setCount(sets[1]), '1 из 2 деталей');
});

test('a hero\'s card says what is on it rather than how many slots it has', async () => {
  const { heroCardMeta, heroesOf } = await load();
  const slot = (s, hero) => ({ slot: s, heroLabel: hero, options: [] });
  const slots = [slot('b:head', 'Bane'), slot('a:head', 'Abaddon'), slot('a:back', 'Abaddon')];
  assert.deepEqual(heroesOf(slots).map(([h, s]) => [h, s.length]), [['Abaddon', 2], ['Bane', 1]]);

  const abaddon = heroesOf(slots)[0][1];
  const set = { id: 's', name: 'Arsenal', heroLabel: 'Abaddon', fit: 1, pieces: [{ slot: 'a:head', itemId: '1', name: 'Helm', fits: true }] };
  const none = () => null;
  assert.equal(heroCardMeta(abaddon, [], none), '2 слота');
  assert.equal(heroCardMeta(abaddon, [set, set, set], none), '3 набора');
  assert.equal(heroCardMeta(abaddon, [set], (s) => (s === 'a:back' ? { itemId: '9' } : null)), 'Изменено 1 из 2');
  assert.equal(heroCardMeta(abaddon, [set], (s) => (s === 'a:head' ? { itemId: '1' } : null)), 'Arsenal', 'a worn set is named');
});

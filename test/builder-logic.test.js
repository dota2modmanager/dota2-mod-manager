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

test("a style rides last in the pick, is read back apart from the effects, and changing it is the button's to save", async () => {
  const { effectKey, liveEffects, liveStyle, stagedItemAction } = await load();
  assert.equal(effectKey(effects, ['snow', 'fire'], 2), 'fire,snow,style-2');
  assert.equal(effectKey(effects, [], 0), '', 'the first style is no token, as picks were before styles');
  const live = { itemId: '42', name: 'Bracers', effectId: 'fire,style-1' };
  assert.deepEqual(liveEffects(live), ['fire'], 'the style is not an effect');
  assert.equal(liveStyle(live), 1);
  assert.equal(liveStyle({ effectId: 'fire' }), 0);
  assert.equal(stagedItemAction(effects, live, { ...staged('42', ['fire']), style: 1 }).off, true, 'what is on already');
  assert.equal(stagedItemAction(effects, live, { ...staged('42', ['fire']), style: 2 }).label, 'Сохранить стиль');
  assert.equal(stagedItemAction(effects, live, { ...staged('42', []), style: 2 }).label, 'Сохранить эффекты', 'both changed: one button saves both');
});

test("another item's effect rides between the effects and the style, and changing it is the button's to save (issue #383)", async () => {
  const { effectKey, liveDonor, liveEffects, liveStyle, stagedItemAction } = await load();
  assert.equal(effectKey(effects, ['fire'], 2, '9002'), 'fire,from-9002,style-2');
  const live = { itemId: '42', name: 'Hat', effectId: 'fire,from-9002,style-1' };
  assert.equal(liveDonor(live), '9002');
  assert.deepEqual(liveEffects(live), ['fire'], 'the donor is not an effect');
  assert.equal(liveStyle(live), 1);
  assert.equal(liveDonor({ effectId: 'fire' }), '');
  assert.equal(stagedItemAction(effects, live, { ...staged('42', ['fire']), style: 1, donor: '9002' }).off, true, 'what is on already');
  assert.equal(stagedItemAction(effects, live, { ...staged('42', ['fire']), style: 1, donor: '' }).label, 'Сохранить эффекты');
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

test('a hero with a persona on shows its persona\'s slots alone, and one without its plain slots', async () => {
  const { withPersonas } = await load();
  const slots = [
    { slot: 'item:pudge:weapon', heroIds: ['pudge'], options: [] },
    { slot: 'item:pudge:persona_selector', heroIds: ['pudge'], options: [], persona: { hero: 'pudge', part: false } },
    { slot: 'item:pudge:weapon_persona_1', heroIds: ['pudge'], options: [], persona: { hero: 'pudge', part: true } },
    { slot: 'item:axe:weapon', heroIds: ['axe'], options: [] },
    { slot: 'weather', options: [] },
  ];
  const shown = (picked) => withPersonas(slots, (s) => (picked.includes(s) ? { itemId: '1' } : null)).map((s) => s.slot);
  assert.deepEqual(shown([]), ['item:pudge:weapon', 'item:pudge:persona_selector', 'item:axe:weapon', 'weather'],
    'no persona: the plain slots and the one to pick a persona in');
  assert.deepEqual(shown(['item:pudge:persona_selector']), ['item:pudge:persona_selector', 'item:pudge:weapon_persona_1', 'item:axe:weapon', 'weather'],
    "the Toy Butcher on: Pudge's plain weapon goes, the persona's comes, other heroes stay");
  assert.deepEqual(shown(['item:pudge:weapon']), shown([]), 'a plain pick is no persona');
});

test("an effect sits on its shelf: the courier unusuals, the game's seasonal ones from 800 up, a courier's own ambient", async () => {
  const { effectGroup, rarityName } = await load();
  assert.equal(effectGroup('unusual-15'), 'unusual', 'Ethereal Flame');
  assert.equal(effectGroup('unusual-826'), 'seasonal', 'Frostbloom');
  assert.equal(effectGroup('frostbloom'), 'seasonal', "the builder's own, drawn with the same particle");
  assert.equal(effectGroup('fire'), 'unusual');
  assert.equal(effectGroup('sand-storm'), 'courier');
  assert.equal(rarityName('mythical'), 'Mythical', 'as the game prints it in every language');
  assert.equal(rarityName(undefined), '');
});

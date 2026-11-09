/* The item builder as a changing room (issues #526, #527): heroes in the order of the game's hero
 * grid (src/item-builder-details.ts heroAttributesSteps, renderer/catalog/builder/logic.ts heroesOf),
 * what a set says about itself (setDetails, eventName), and the sets window's sort and filters
 * (renderer/catalog/builder/set-filters.ts).
 *
 * The promise: a hero sits in the group its own script names, and in alphabetical order inside
 * it; a set's rarity, date, event and styles come from the game in the player's words; the sets
 * window sorts and narrows by them, and a stored filter the window cannot use is its default. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { eventName, eventNames, heroAttributesSteps, itemFacts, setDetails } from '../src/item-builder-details.ts';
import { drain } from '../src/steps.ts';
import { activeFilters, filterSets, readSetFilters, setFacets, SET_FILTERS, writeSetFilters } from '../renderer/catalog/builder/set-filters.ts';
import type { ItemSet } from '../src/item-builder-sets.ts';
import type { CosmeticSet, CosmeticSlot } from '../renderer/catalog/types.ts';

const script = (attr: string) => Buffer.from(`"DOTAHeroes"\n{\n\t"npc_dota_hero_x"\n\t{\n\t\t"AttributePrimary"\t\t"${attr}"\n\t}\n}\n`);

test("a hero's group is the attribute its own script names, and a hero without one is left out", () => {
  const files: Record<string, Buffer> = {
    'scripts/npc/heroes/npc_dota_hero_axe.txt': script('DOTA_ATTRIBUTE_STRENGTH'),
    'scripts/npc/heroes/npc_dota_hero_luna.txt': script('DOTA_ATTRIBUTE_AGILITY'),
    'scripts/npc/heroes/npc_dota_hero_lina.txt': script('DOTA_ATTRIBUTE_INTELLECT'),
    'scripts/npc/heroes/npc_dota_hero_pangolier.txt': script('DOTA_ATTRIBUTE_ALL'),
  };
  const index = { read: (rel: string) => files[rel] || null };
  assert.deepEqual(drain(heroAttributesSteps(index, ['axe', 'luna', 'lina', 'pangolier', 'axe', 'newhero', '../escape'])),
    { axe: 'str', luna: 'agi', lina: 'int', pangolier: 'all' });
});

test('the hub lists heroes as the game does: strength, agility, intelligence, universal, each alphabetical', async () => {
  globalThis.window = { I18N_LANG: 'ru' } as unknown as Window & typeof globalThis;
  (globalThis as Record<string, unknown>).L = (s: TemplateStringsArray | string, ...v: unknown[]) => (typeof s === 'string' ? s : s.reduce((o, p, i) => o + p + (i < v.length ? String(v[i]) : ''), ''));
  const { heroesOf } = await import('../renderer/catalog/builder/logic.ts');
  const slot = (hero: string, label: string): CosmeticSlot => ({ slot: `item:${hero}:head`, heroIds: [hero], heroLabel: label, options: [] } as unknown as CosmeticSlot);
  const slots = [slot('pangolier', 'Pangolier'), slot('lina', 'Lina'), slot('axe', 'Axe'), slot('luna', 'Luna'), slot('abaddon', 'Abaddon'),
    slot('alchemist', 'Alchemist'), slot('ghost', 'Ghost')];
  const attrs = { pangolier: 'all', lina: 'int', axe: 'str', luna: 'agi', abaddon: 'all', alchemist: 'str' } as const;
  assert.deepEqual(heroesOf(slots, attrs).map(([h]) => h), ['Alchemist', 'Axe', 'Luna', 'Lina', 'Abaddon', 'Pangolier', 'Ghost'],
    'a hero the game said nothing about goes last');
  assert.deepEqual(heroesOf(slots).map(([h]) => h), ['Abaddon', 'Alchemist', 'Axe', 'Ghost', 'Lina', 'Luna', 'Pangolier'], 'without attributes, alphabetical');
});

test('an event id reads as the event, and "none" or a bare number is no event', () => {
  assert.equal(eventName('EVENT_ID_FALL_2021'), 'Fall 2021');
  assert.equal(eventName('EVENT_ID_INTERNATIONAL_2019'), 'The International 2019');
  assert.equal(eventName('EVENT_ID_CROWNFALL'), 'Crownfall');
  assert.equal(eventName('EVENT_ID_10TH_ANNIVERSARY'), '10th Anniversary', 'a word that starts with a number');
  assert.equal(eventName('EVENT_ID_NONE'), '');
  assert.equal(eventName('25'), '');
});

test("an event the game names is called by the game's name in the player's language, and spelled out only where it has none", () => {
  // as dota_english.txt and dota_russian.txt of the game of 2026-11-09 have them
  const tokens = new Map([
    ['dota_eventname_international2019', 'The International 2019 Battle Pass'],
    ['dota_eventnameshort_international2019', 'The International 2019'],
    ['dota_eventname_spring2021', 'Враждостояние'],
    ['dota_eventname_newbloom2019', 'New Bloom'],
    ['dota_eventname_muertarelease_spring2023', 'Dead Reckoning'],
    ['dota_eventname_international2022', 'The 2022 Battle Pass'],
    ['dota_eventname_none', 'N/A'],
  ]);
  const names = eventNames(tokens);
  assert.equal(eventNames(tokens), names, 'worked out once per table of tokens');
  assert.equal(eventName('EVENT_ID_INTERNATIONAL_2019', names), 'The International 2019', 'the short name before the long one');
  assert.equal(eventName('EVENT_ID_SPRING_2021', names), 'Враждостояние 2021', 'the year a name lacks comes from the id');
  assert.equal(eventName('EVENT_ID_NEW_BLOOM_2019', names), 'New Bloom 2019');
  assert.equal(eventName('EVENT_ID_MUERTA_RELEASE_SPRING2023', names), 'Dead Reckoning 2023', 'underscores in other places than the id');
  assert.equal(eventName('EVENT_ID_INTERNATIONAL_2022', names), 'The 2022 Battle Pass', 'a name with its own number keeps it');
  assert.equal(eventName('EVENT_ID_FALL_2025', names), 'Fall 2025', 'an event the game does not name');
  assert.equal(eventName('EVENT_ID_NONE', names), '', 'the game\'s "N/A" is still no event');
});

const itemSet = (over: Partial<ItemSet>): ItemSet => ({
  id: '1', name: 'Blightfall', heroIds: ['abaddon'], fit: 2, heroLabel: 'Abaddon', rarity: 'mythical', date: '2021-08-18',
  event: 'EVENT_ID_FALL_2021', nameToken: '#DOTA_Item_Blightfall', descToken: '', styles: 1,
  pieces: [{ name: 'Head', itemId: '10', fits: true, slot: 'item:abaddon:head', slotLabel: 'Head' }], ...over,
});

test("a set's name, rarity and styles come in the player's words, the set's own name where the game has none", () => {
  const words: Record<string, string> = { '#DOTA_Item_Blightfall': 'Порча', '#Rarity_mythical': 'Мифический' };
  const named = (token: string) => words[token] || '';
  const styled = itemSet({ styles: 2, pieces: [
    { name: 'Head', itemId: '10', fits: true, slot: 'item:abaddon:head', slotLabel: 'Head' },
    { name: 'Back', itemId: '11', fits: true, slot: 'item:abaddon:back', slotLabel: 'Back', styles: 2 },
  ] });
  const [s] = setDetails([styled], named, (id) => (id === '11' ? ['Синий', 'Красный'] : undefined));
  assert.equal(s.title, 'Порча');
  assert.equal(s.rarityName, 'Мифический');
  assert.equal(s.eventName, 'Fall 2021');
  assert.deepEqual(s.styleNames, ['Синий', 'Красный'], 'the names of the piece with the most styles');
  const [described] = setDetails([itemSet({ descToken: '#Desc', event: 'EVENT_ID_FALL_2021' })],
    (token) => (token === '#Desc' ? 'Includes:<br><br>\t- <font color="#e4ae39">Head</font> &amp; Back &#8212; 2 items<BR/>' : ''), () => undefined,
    eventNames(new Map([['dota_eventname_fall2021', "Aghanim's Labyrinth 2021"]])));
  assert.equal(described.description, 'Includes:\n\n\t- Head & Back — 2 items', "the game's markup made plain text");
  assert.equal(described.eventName, "Aghanim's Labyrinth 2021");
  const [compared] = setDetails([itemSet({ descToken: '#Desc' })], () => 'Damage 2 < 3 > 1 &unknown;', () => undefined);
  assert.equal(compared.description, 'Damage 2 < 3 > 1 &unknown;', 'only tags are taken out, and only entities it knows are read');
  const [plain] = setDetails([itemSet({ nameToken: '', rarity: 'immortal' })], named, () => undefined);
  assert.equal(plain.title, 'Blightfall');
  assert.equal(plain.rarityName, 'Immortal', 'a rarity the language file lacks keeps its key');
  assert.deepEqual(plain.styleNames, []);
});

const set = (name: string, rarity: string, date: string, event = '', styles = 1): CosmeticSet =>
  ({ id: name, name, heroLabel: 'Abaddon', fit: 1, pieces: [], rarity, rarityName: rarity, date, event, eventName: eventName(event), styles });
const SETS = [set('Bravo', 'rare', '2014-03-01'), set('Alpha', 'arcana', '2021-08-18', 'EVENT_ID_FALL_2021', 2), set('Charlie', 'mythical', '2019-01-02', 'EVENT_ID_FALL_2021'), set('Delta', 'rare', '')];

test('the sets window sorts by name, date and rarity, and narrows by rarity, years, event and styles', () => {
  const names = (patch: Partial<typeof SET_FILTERS>) => filterSets(SETS, { ...SET_FILTERS, ...patch }).map((s) => s.name);
  assert.deepEqual(names({}), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(names({ sort: 'new' }), ['Alpha', 'Charlie', 'Bravo', 'Delta']);
  assert.deepEqual(names({ sort: 'old' }), ['Bravo', 'Charlie', 'Alpha', 'Delta'], 'a set without a date goes last either way');
  assert.deepEqual(names({ sort: 'rare' }), ['Alpha', 'Charlie', 'Bravo', 'Delta']);
  assert.deepEqual(names({ rarity: 'rare' }), ['Bravo', 'Delta']);
  assert.deepEqual(names({ from: '2015', to: '2020' }), ['Charlie'], 'a set without a date is out once a year is asked for');
  assert.deepEqual(names({ event: 'EVENT_ID_FALL_2021' }), ['Alpha', 'Charlie'], 'by the id, which stays when the language changes the name');
  assert.deepEqual(names({ styled: true }), ['Alpha']);
  assert.equal(activeFilters({ ...SET_FILTERS, sort: 'rare', rarity: 'rare', styled: true }), 2, 'the sort is not a filter');
  assert.deepEqual(setFacets(SETS), {
    rarities: [{ value: 'rare', label: 'rare' }, { value: 'mythical', label: 'mythical' }, { value: 'arcana', label: 'arcana' }],
    years: ['2014', '2019', '2021'],
    events: [{ value: 'EVENT_ID_FALL_2021', label: 'Fall 2021' }],
  });
});

test('the sets toolbar comes back as it was left, and a stored value it cannot use is its default', () => {
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
  writeSetFilters(store, { ...SET_FILTERS, sort: 'rare', rarity: 'arcana', from: '2015', event: 'EVENT_ID_FALL_2021', styled: true });
  assert.deepEqual(readSetFilters(store), { ...SET_FILTERS, sort: 'rare', rarity: 'arcana', from: '2015', event: 'EVENT_ID_FALL_2021', styled: true });
  kept.set('mm-set-filters', '{"sort":"new","event":"Fall 2021"}');
  assert.deepEqual(readSetFilters(store), { ...SET_FILTERS, sort: 'new' }, 'an event kept by its name, before names came from the game');
  kept.set('mm-set-filters', '{"sort":"loudest","rarity":7,"styled":"yes"}');
  assert.deepEqual(readSetFilters(store), SET_FILTERS);
  kept.set('mm-set-filters', 'not json');
  assert.deepEqual(readSetFilters(store), SET_FILTERS);
  assert.deepEqual(readSetFilters(null), SET_FILTERS);
});

test("an item's rarity and release day come out of its own block, and only what the block says", () => {
  const block = ['"4321"', '\t{', '\t\t"name"\t\t"Blightfall - Head"', '\t\t"item_rarity"\t\t"Mythical"', '\t\t"creation_date"\t\t"2021-08-18"', '\t}'].join('\n');
  assert.deepEqual(itemFacts(block), { rarity: 'mythical', date: '2021-08-18' });
  assert.deepEqual(itemFacts(['"1"', '\t{', '\t\t"name"\t\t"Stock"', '\t}'].join('\n')), {}, 'a stock item says neither');
  assert.deepEqual(itemFacts(['"2"', '\t{', '\t\t"creation_date"\t\t"soon"', '\t}'].join('\n')), {}, 'a date that is not one is left out');
});


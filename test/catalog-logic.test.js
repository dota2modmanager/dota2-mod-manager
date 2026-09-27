/* The catalog screen's rules, out of the screen (renderer/catalog/*.ts): which mods a category
 * holds, which tags become chips and which a dropdown, and how the toolbar narrows and sorts.
 * Node runs the TypeScript as it is; nothing is built for these. */
const test = require('node:test');
const assert = require('node:assert/strict');

// i18n.js puts tr on window before any module runs; the tests read the Russian source
globalThis.tr = (s) => s;

const load = async () => ({
  mods: await import('../renderer/catalog/mods.ts'),
  tags: await import('../renderer/catalog/tags.ts'),
  filters: await import('../renderer/catalog/filters.ts'),
});

const names = (list) => list.map((m) => m.name);
const freshFilters = () => ({ sort: 'default', tags: new Set(), installedOnly: false, favOnly: false, group: '', hero: '', slot: '' });
const noChecks = { isInstalled: () => false, isFav: () => false, heroMatches: () => true };

test('a flat category keeps its order, drops the tools this app replaces, and lists the user\'s packs last', async () => {
  const { mods } = await load();
  const tools = [{ name: 'VPK Creator' }, { name: 'Hero Grid Maker' }];
  assert.deepEqual(names(mods.modsOf(tools, 'tools', { toolsHidden: [/vpk creator/i] })), ['Hero Grid Maker']);
  assert.deepEqual(names(mods.modsOf(tools, 'terrain', { toolsHidden: [/vpk creator/i] })), ['VPK Creator', 'Hero Grid Maker'],
    'only the tools category hides anything');

  const packs = mods.modsOf([{ name: 'Starter' }], 'packs', { customPacks: [{ name: 'Mine', mods: ['a'] }] });
  assert.deepEqual(names(packs), ['Starter', 'Mine']);
  assert.equal(packs[1]._custom, true);
  assert.equal(packs[1].type, 'pack');
  assert.equal(packs[0]._group, null);
});

test('a grouped category comes out flat, each mod carrying its group', async () => {
  const { mods } = await load();
  const data = { groups: [{ name: 'Pudge', id: 'pudge', mods: [{ name: 'Hook' }, { name: 'Cleaver' }] }, { name: 'Lina', mods: [{ name: 'Fire' }] }] };
  const out = mods.modsOf(data, 'hero-items');
  assert.deepEqual(out.map((m) => [m.name, m._group]), [['Hook', 'Pudge'], ['Cleaver', 'Pudge'], ['Fire', 'Lina']]);
  assert.equal(out[0]._groupId, 'pudge');
  assert.equal(mods.isGrouped(data), true);
  assert.equal(mods.isGrouped([]), false);
  assert.deepEqual(mods.modsOf(undefined, 'x'), []);
  assert.deepEqual(mods.modsOf({}, 'x'), [], 'data with neither a list nor groups holds nothing');
});

test('only an archive is installable, from the mod itself or from one of its styles', async () => {
  const { mods } = await load();
  assert.equal(mods.installTarget({ name: 'a', file: 'x.VPK' }), 'x.VPK');
  assert.equal(mods.installTarget({ name: 'a', file: 'x.zip' }), 'x.zip');
  assert.equal(mods.installTarget({ name: 'a', file: 'https://site' }), null);
  assert.equal(mods.canBeInstalled({ name: 'a', styles: [{ label: 'red', file: 'red.vpk' }] }), true);
  assert.equal(mods.canBeInstalled({ name: 'guide', links: [{ url: 'u' }] }), false);
});

test('the mod index is keyed by the lower-case name, across every category', async () => {
  const { mods } = await load();
  const data = { heroes: [{ name: 'Pudge Toy' }], terrain: [{ name: 'Desert' }, { name: '' }] };
  const index = mods.modIndexOf([{ id: 'heroes' }, { id: 'terrain' }], (id) => mods.modsOf(data[id], id));
  assert.deepEqual([...index.keys()], ['pudge toy', 'desert'], 'a mod without a name is not indexed');
  assert.equal(index.get('desert').categoryId, 'terrain');
});

test('what a mod changes is a chip, commonest first; the slot it sits in is a dropdown', async () => {
  const { tags } = await load();
  const list = [
    { name: 'a', tags: { effects: true, weapon: true } },
    { name: 'b', tags: { effects: true, icons: true, arm: true } },
    { name: 'c', tags: { icons: true, sounds: false, arms: true } },
    { name: 'd', tags: { effects: true } },
  ];
  assert.deepEqual(tags.collectTags(list), ['effects', 'icons'], 'a tag set to false is not a chip, and slots never are');
  assert.deepEqual(tags.collectSlots(list, (t) => tags.tagLabel(t)), ['weapon', 'arms'], '"arm" and "arms" are one slot, A-Z by the word shown: Оружие, Руки');
  assert.deepEqual(tags.modTags(list[1]), ['effects', 'icons', 'arms']);
});

test('a tag gets our word, else the catalog\'s label, else its key with a capital', async () => {
  const { tags } = await load();
  assert.equal(tags.tagLabel('effects'), 'Эффекты');
  assert.equal(tags.tagLabel('arm'), 'Руки');
  assert.equal(tags.tagLabel('newthing', { newthing: 'brand new' }), 'Brand new');
  assert.equal(tags.tagLabel('newthing'), 'Newthing');
});

test('groups come out once each, in the catalog\'s order', async () => {
  const { tags } = await load();
  assert.deepEqual(tags.collectGroups([{ name: 'a', _group: 'Lina' }, { name: 'b', _group: 'Axe' }, { name: 'c', _group: 'Lina' }, { name: 'd', _group: null }]), ['Lina', 'Axe']);
});

test('the toolbar narrows by every filter at once and sorts only when asked', async () => {
  const { filters } = await load();
  const list = [
    { name: 'Pudge Hook', _group: 'Pudge', tags: { effects: true, weapon: true }, meta: { date: 3 } },
    { name: 'Axe Blade', _group: 'Axe', tags: { effects: true, arm: true }, meta: { date: 9 } },
    { name: 'Pudge Gut', _group: 'Pudge', tags: { icons: true }, meta: { date: 5 } },
  ];
  assert.deepEqual(names(filters.applyFilters(list, freshFilters(), noChecks)), names(list), 'nothing on keeps the catalog\'s order');

  const f = freshFilters();
  f.group = 'Pudge';
  assert.deepEqual(names(filters.applyFilters(list, f, noChecks)), ['Pudge Hook', 'Pudge Gut']);
  f.tags.add('effects');
  assert.deepEqual(names(filters.applyFilters(list, f, noChecks)), ['Pudge Hook'], 'every chip has to hold');

  const bySlot = { ...freshFilters(), slot: 'arms' };
  assert.deepEqual(names(filters.applyFilters(list, bySlot, noChecks)), ['Axe Blade'], 'the slot matches however the catalog spelled it');

  const checks = { isInstalled: (m) => m.name === 'Axe Blade', isFav: (m) => m.name !== 'Axe Blade', heroMatches: (h, n) => n.startsWith(h) };
  assert.deepEqual(names(filters.applyFilters(list, { ...freshFilters(), installedOnly: true }, checks)), ['Axe Blade']);
  assert.deepEqual(names(filters.applyFilters(list, { ...freshFilters(), favOnly: true }, checks)), ['Pudge Hook', 'Pudge Gut']);
  assert.deepEqual(names(filters.applyFilters(list, { ...freshFilters(), hero: 'Axe' }, checks)), ['Axe Blade']);

  assert.deepEqual(names(filters.applyFilters(list, { ...freshFilters(), sort: 'date' }, noChecks)), ['Axe Blade', 'Pudge Gut', 'Pudge Hook']);
  assert.deepEqual(names(filters.applyFilters(list, { ...freshFilters(), sort: 'name' }, noChecks)), ['Axe Blade', 'Pudge Gut', 'Pudge Hook']);
  assert.deepEqual(names(filters.applyFilters(list, { ...freshFilters(), sort: 'name-desc' }, noChecks)), ['Pudge Hook', 'Pudge Gut', 'Axe Blade']);
  assert.equal(list[0].name, 'Pudge Hook', 'sorting leaves the list it was given alone');
});

test('sorting is not narrowing', async () => {
  const { filters } = await load();
  assert.equal(filters.narrowed({ ...freshFilters(), sort: 'name' }), false);
  for (const change of [{ installedOnly: true }, { favOnly: true }, { group: 'x' }, { hero: 'x' }, { slot: 'x' }]) {
    assert.equal(filters.narrowed({ ...freshFilters(), ...change }), true, JSON.stringify(change));
  }
  assert.equal(filters.narrowed({ ...freshFilters(), tags: new Set(['effects']) }), true);
});

test('a card answers for the look on show: its own install badge, and its own entry in the list', async () => {
  const store = await import('../renderer/core/store.js');
  const looks = await import('../renderer/catalog/looks.ts');
  const queueing = await import('../renderer/catalog/queueing.ts');
  const mod = { name: 'Lina Flame', file: 'lina.vpk', styles: [{ label: 'Red', file: 'red.vpk', preview: 'red.png' }, { label: 'Blue', file: 'blue.vpk' }] };
  store.state.installedIndex.clear();
  store.state.installedIndex.set('heroes|Lina Flame|Blue', {});
  store.state.catalog = { constants: { addToCartRules: {} } };

  assert.equal(looks.styleIndex('heroes', mod), 0, 'the catalog\'s first look until one is picked');
  assert.equal(looks.isInstalled('heroes', mod), true, 'some look of it is installed');
  assert.equal(looks.lookInstalled('heroes', mod), false, 'but not the red one on show');
  assert.equal(queueing.queueEntry('heroes', mod).key, 'heroes|Lina Flame|Red');

  looks.pickStyle('heroes', mod, 1);
  assert.equal(looks.shownStyle('heroes', mod).label, 'Blue');
  assert.equal(looks.lookInstalled('heroes', mod), true);
  assert.equal(queueing.queueEntry('heroes', mod).file, 'blue.vpk');

  looks.pickStyle('heroes', mod, 9);
  assert.equal(looks.styleIndex('heroes', mod), 0, 'a look that is gone falls back to the first');
  store.state.installedIndex.clear();
});

test('the install list takes only what the catalog\'s own rules allow', async () => {
  const store = await import('../renderer/core/store.js');
  const { canQueue } = await import('../renderer/catalog/queueing.ts');
  store.state.catalog = { constants: { addToCartRules: { hiddenCategories: ['tools'], allowedMods: { couriers: ['Golden Baby Roshan'] } } } };
  assert.equal(canQueue('heroes', { name: 'a', file: 'a.vpk' }), true);
  assert.equal(canQueue('heroes', { name: 'a', links: [{ url: 'u' }] }), false, 'a link is not a download');
  assert.equal(canQueue('tools', { name: 'a', file: 'a.zip' }), false);
  assert.equal(canQueue('heroes', { name: 'p', type: 'pack', file: 'p.zip' }), false, 'a pack is a list already');
  assert.equal(canQueue('couriers', { name: 'golden baby roshan', file: 'g.vpk' }), true);
  assert.equal(canQueue('couriers', { name: 'Other Courier', file: 'o.vpk' }), false);
  store.state.catalog = null;
});

test('a star is saved with the settings, and comes back off on a second press', async () => {
  const store = await import('../renderer/core/store.js');
  const fav = await import('../renderer/catalog/favorites.ts');
  const saved = [];
  globalThis.window = { api: { settings: { set: async (key, value) => { saved.push([key, value]); return { favorites: value }; } } } };
  store.state.favorites.clear();
  assert.equal(await fav.toggleFavorite('heroes', 'Lina Flame'), true);
  assert.equal(fav.isFav('heroes', 'Lina Flame'), true);
  assert.deepEqual(saved.at(-1), ['favorites', ['heroes|Lina Flame']]);
  assert.equal(await fav.toggleFavorite('heroes', 'Lina Flame'), false);
  assert.deepEqual(saved.at(-1), ['favorites', []]);
  delete globalThis.window;
});

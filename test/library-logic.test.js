/* My mods' rules, out of the screen (renderer/library/*.ts): the load order the list is shown in,
 * which rows a search leaves, and what the bulk bar can do with the ticked ones. Node runs the
 * TypeScript as it is. */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = async () => ({
  order: await import('../renderer/library/order.ts'),
  sel: await import('../renderer/library/selection.ts'),
});

const pak = (n, on = true) => ({ root: 'lang', relPath: `pak${String(n).padStart(2, '0')}_dir.vpk`, on });
const rec = (id, extra = {}) => ({ id, name: id, enabled: true, categoryId: 'heroes', files: [], ...extra });

test('the list runs in the order the game loads the paks, and the moves stop at a zone\'s ends', async () => {
  const { order } = await load();
  const records = [
    rec('late', { files: [pak(40)], zone: 1 }),
    rec('font', { categoryId: 'fonts', files: [{ root: 'fonts', relPath: 'x.ttf' }] }),
    rec('early', { files: [pak(3)], zone: 0 }),
    rec('mid', { files: [pak(12)], zone: 1 }),
    rec('look', { categoryId: 'cosmetic', slot: 'weather' }),
  ];
  const placed = order.loadOrder(records);
  assert.deepEqual([...placed.keys()], ['early', 'mid', 'late'], 'a font and a cosmetic pick have no pak to be ordered by');
  assert.deepEqual(placed.get('early'), { index: 0, zoneFirst: true, zoneLast: true });
  assert.deepEqual(placed.get('mid'), { index: 1, zoneFirst: true, zoneLast: false });
  assert.deepEqual(placed.get('late'), { index: 2, zoneFirst: false, zoneLast: true });

  const parts = order.listParts(records, '', placed);
  assert.deepEqual(parts.mods.map((r) => r.id), ['early', 'mid', 'late', 'font'], 'what has no place closes the list');
  assert.deepEqual(parts.cosmetics.map((r) => r.id), ['look'], 'cosmetic picks are a list of their own');

  assert.equal(order.pakOf(records[0]), 40);
  assert.equal(order.pakFileName(records[0]), 'pak40_dir.vpk');
  assert.equal(order.pakFileName({ ...records[0], enabled: false }), 'pak40_dir.vpk.off', 'the name the folder shows');
  assert.equal(order.pakFileName(records[1]), null);
});

test('a search finds a pack by the name of a mod inside it', async () => {
  const { order } = await load();
  const pack = rec('Winter pack', { kind: 'pack', members: [{ id: 'a', name: 'Aghanim Labyrinth' }] });
  assert.equal(order.matchesSearch(pack, 'labyr'), true);
  assert.equal(order.matchesSearch(pack, '  WINTER '), true);
  assert.equal(order.matchesSearch(pack, 'pudge'), false);
  assert.equal(order.matchesSearch(pack, '   '), true, 'an empty search leaves everything');
});

test('a row the user named (issue #399) is found by that name, and the name never reaches the file', async () => {
  const { order } = await load();
  const labels = await import('../renderer/library/labels.ts');
  const mine = rec('Pudge Arcana');
  labels.labels.map = labels.withLabel({}, labels.recLabelKey(mine.id), '  the   red  one ');
  assert.equal(labels.labelFor(labels.recLabelKey(mine.id)), 'the red one', 'spaces are tidied');
  assert.equal(order.matchesSearch(mine, 'RED'), true);
  assert.equal(order.matchesSearch(mine, 'pudge'), true, 'the name it came with still finds it');
  assert.equal(order.matchesSearch(rec('Lina'), 'red'), false);

  const off = labels.fileLabelKey('pak33_dir.vpk.off');
  assert.equal(off, labels.fileLabelKey('PAK33_dir.vpk'), 'switching a file off and on keeps its label');
  const long = labels.withLabel(labels.labels.map, off, 'x'.repeat(200));
  assert.equal(long[off].length, labels.LABEL_MAX);
  const cleared = labels.withLabel(long, off, '   ');
  assert.equal(Object.hasOwn(cleared, off), false, 'an empty label takes the name away');
  assert.equal(Object.hasOwn(long, off), true, 'the map passed in is left as it was');
  assert.equal(labels.labelFor('__proto__'), null);
  labels.labels.map = {};
});

test('the selection forgets what is gone, and the bulk bar offers only what the ticked rows allow', async () => {
  const { sel } = await load();
  const vpk = { root: 'lang', relPath: 'pak05_dir.vpk' };
  const records = [
    rec('mod', { files: [vpk] }),
    rec('other', { files: [vpk], match: [{ categoryId: 'heroes', name: 'Other' }] }),
    rec('pack', { kind: 'pack', files: [vpk], members: [{ id: 'm1', name: 'M1' }] }),
    rec('cursor', { categoryId: 'cursors', files: [{ root: 'cursor', relPath: 'a.cur' }] }),
  ];
  const ticked = new Set(['mod', 'pack', 'cursor', 'gone', sel.memberKey('pack', 'm1'), sel.memberKey('gone', 'x')]);
  sel.pruneSelection(ticked, records);
  assert.deepEqual([...ticked].sort(), ['cursor', 'm:pack:m1', 'mod', 'pack']);

  assert.deepEqual(sel.bulkOffer(ticked, records), { count: 4, combinable: 2, adoptable: 0, members: 1 },
    'a cursor is loose files, not a pak, and stays out of a pack');
  ticked.add('other');
  assert.equal(sel.bulkOffer(ticked, records).adoptable, 1);
  assert.deepEqual(sel.memberOf('m:pack:m1'), { packId: 'pack', memberId: 'm1' });
});

test('each "select all" covers its own list, and says when only some are ticked', async () => {
  const { sel } = await load();
  const records = [
    rec('a'), rec('b'),
    rec('font', { files: [{ root: 'fonts', relPath: 'x.ttf' }] }),
    rec('look', { categoryId: 'cosmetic', slot: 'weather' }),
  ];
  const mods = sel.selectableMods(records, '');
  assert.deepEqual(mods, ['a', 'b'], 'a font has no switch, so nothing to tick');
  assert.deepEqual(sel.selectableCosmetics(records, ''), ['look']);
  assert.deepEqual(sel.tristate(mods, new Set(['a'])), { checked: false, indeterminate: true });
  assert.deepEqual(sel.tristate(mods, new Set(['a', 'b', 'look'])), { checked: true, indeterminate: false });
  assert.deepEqual(sel.tristate([], new Set()), { checked: false, indeterminate: false });
});

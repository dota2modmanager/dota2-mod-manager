/* The own-cursor window's rules, out of its screen (renderer/catalog/cursor/design.ts, kinds.ts):
 * where each cursor comes from, a whole set put on at once, and what a stored design reads back as.
 * The files written from them are crates/mm-core/src/looks/cursor_maker.rs. */
import test from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as unknown as Record<string, unknown>;
g.window = { I18N_LANG: 'ru' };
g.L = (strings: TemplateStringsArray | string, ...values: unknown[]) => (typeof strings === 'string'
  ? strings
  : strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), ''));

const load = async () => ({ ...(await import('../renderer/catalog/cursor/design.ts')), ...(await import('../renderer/catalog/cursor/kinds.ts')) });
const PIC = 'a'.repeat(40);

test('the cursors the game has come in the table order, the unknown ones last', async () => {
  const { kindsOf } = await load();
  const kinds = kindsOf(['cursor_spell_enemy', 'cursor_zzz_new', 'cursor_default', 'cursor_db_ibeam']);
  assert.deepEqual(kinds.map((k) => k.name), ['cursor_default', 'cursor_spell_enemy', 'cursor_db_ibeam', 'cursor_zzz_new']);
  assert.equal(kinds[3].group, 'other');
});

test('a set\'s folder reads as a name', async () => {
  const { packName } = await load();
  assert.equal(packName('valve/ti9'), 'TI9');
  assert.equal(packName('valve/emerald_ocean'), 'Emerald Ocean');
  assert.equal(packName('workshop/bts3_cursor_pack'), 'BTS3');
  assert.equal(packName('workshop/pw_golden_cursors'), 'PW Golden');
});

test('every cursor is the game\'s until it is given another source, and the game\'s is no entry', async () => {
  const { EMPTY_DESIGN, sourceOf, withSource } = await load();
  assert.deepEqual(sourceOf(EMPTY_DESIGN, 'cursor_default'), { from: 'game' });
  const d = withSource(EMPTY_DESIGN, 'cursor_default', { from: 'pack', pack: 'valve/ti9' });
  assert.deepEqual(sourceOf(d, 'cursor_default'), { from: 'pack', pack: 'valve/ti9' });
  assert.deepEqual(withSource(d, 'cursor_default', { from: 'game' }).states, {});
});

test('a set put on whole is recognised, and stops being so once one cursor differs', async () => {
  const { EMPTY_DESIGN, withPack, withSource, wholePack } = await load();
  const packs = [{ id: 'valve/ti9', names: ['cursor_default', 'cursor_buy'] }, { id: 'valve/ti8', names: ['cursor_default'] }];
  const d = withPack(EMPTY_DESIGN, 'valve/ti9', packs[0].names);
  assert.equal(wholePack(d, packs), 'valve/ti9');
  assert.equal(wholePack(withSource(d, 'cursor_buy', { from: 'game' }), packs), null);
  assert.equal(wholePack(withSource(d, 'cursor_buy', { from: 'pack', pack: 'valve/ti8' }), packs), null);
  assert.equal(wholePack(EMPTY_DESIGN, packs), null);
});

test('the tip is the opaque pixel nearest the top left', async () => {
  const { tipOf } = await load();
  const w = 4;
  const px = new Uint8ClampedArray(w * w * 4);
  px[(1 * w + 2) * 4 + 3] = 255; // x 2, y 1
  px[(3 * w + 0) * 4 + 3] = 255; // x 0, y 3: further along
  px[(0 * w + 0) * 4 + 3] = 40; // too faint to count
  assert.deepEqual(tipOf(px, w, w), [0.5, 0.25]);
});

test('a picture is fitted in the middle of the cursor', async () => {
  const { place } = await load();
  assert.deepEqual(place(100, 50, 1), { x: 0, y: 0.25, w: 1, h: 0.5 });
});

test('a stored design reads back with what is broken in it dropped', async () => {
  const { cleanDesign, picturesOf } = await load();
  const d = cleanDesign({
    states: {
      cursor_default: { from: 'own' }, cursor_buy: { from: 'own', picture: PIC, hot: [2, -1] },
      cursor_move: { from: 'pack', pack: 'valve/ti9' }, cursor_spell_team: { from: 'pack', pack: '../../x' },
      '../x': { from: 'pack', pack: 'valve/ti9' }, cursor_coach: { mode: 'auto' },
    },
  });
  assert.deepEqual(d.states, { cursor_buy: { from: 'own', picture: PIC, hot: [1, 0] }, cursor_move: { from: 'pack', pack: 'valve/ti9' } });
  assert.deepEqual(picturesOf(d), [PIC]);
});

/* The slots the game has no free item for (src/schema-items.ts OWNERLESS_SLOTS): the multikill
 * banner and the Tormentor. The picked item is flagged as the free one; the slot was missing from
 * the free cosmetics because it has no base item to dress. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cosmeticOptions, mergeSchema, ownerlessPatch } from '../src/schema.ts';
import { lookPatch } from '../src/courier-models.ts';

const item = (id: string, name: string, lines: string) =>
  `\t\t"${id}"\r\n\t\t{\r\n\t\t\t"name"\t\t"${name}"\r\n${lines}\t\t}\r\n`;
const line = (k: string, v: string) => `\t\t\t"${k}"\t\t"${v}"\r\n`;
const VISUALS = '\t\t\t"visuals"\r\n\t\t\t{\r\n\t\t\t}\r\n';

const TABLE = `"items_game"\r\n{\r\n\t"items"\r\n\t{\r\n${[
  item('10731', 'Battle Glory Kill Banner', line('prefab', 'misc') + line('item_slot', 'multikill_banner')),
  item('11548', 'The International 2016 Multikill Banner', line('prefab', 'misc') + line('item_slot', 'multikill_banner')),
  item('29339', '10th Anniversary Tormentor', line('prefab', 'tormentor') + VISUALS),
  item('34576', 'Obscene Eye Ball', line('prefab', 'tormentor') + line('baseitem', '0') + VISUALS),
  item('555', 'Default Weather', line('prefab', 'weather') + line('baseitem', '1') + VISUALS),
  item('5000', 'Rain', line('prefab', 'weather') + VISUALS),
].join('')}\t}\r\n}\r\n`;

test('the banners are offered though neither has visuals, since the game draws the one worn', () => {
  assert.deepEqual(cosmeticOptions(TABLE, 'multikill_banner').map((o) => o.id), ['10731', '11548']);
  assert.deepEqual(cosmeticOptions(TABLE, 'tormentor').map((o) => o.id), ['29339', '34576']);
  // an ordinary slot still wants visuals
  assert.deepEqual(cosmeticOptions(TABLE, 'weather').map((o) => o.id), ['5000']);
});

test('a look in an ownerless slot is the picked item flagged as the free one, once', () => {
  const block = ownerlessPatch(TABLE, 'tormentor', '34576')!;
  assert.equal(block.match(/"baseitem"/g)?.length, 1, 'the item\'s own "0" goes');
  assert.match(block, /"baseitem"\t\t"1"\r\n\t\t\}$/);
  assert.match(block, /^"34576"/);
  const merged = mergeSchema(TABLE, [lookPatch(TABLE, '', { name: 'Eye', slot: 'tormentor', itemId: '34576' }, () => {})!]);
  assert.deepEqual(merged.applied, [{ id: '34576', source: 'Eye' }]);
  assert.equal(merged.text.match(/"baseitem"\t\t"1"/g)?.length, 2, 'the weather base and the eye');
});

test('an item of another slot, or a slot that has a base item, is not flagged', () => {
  assert.equal(ownerlessPatch(TABLE, 'tormentor', '10731'), null);
  assert.equal(ownerlessPatch(TABLE, 'weather', '5000'), null);
  // weather keeps going through its base item
  assert.equal(lookPatch(TABLE, '', { name: 'Rain', slot: 'weather', itemId: '5000' }, () => {})?.id, '555');
});

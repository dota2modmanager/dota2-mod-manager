/* What the item builder says about an arcana before somebody picks it (src/arcana-notes.ts): the
 * pass through every arcana on 2026-10-15, an arcana nobody has played yet, Io, and the words in
 * every language the window speaks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemNote, ARCANA_NOTES, ARCANAS_THAT_WORK, isArcanaBlock } from '../src/arcana-notes.ts';
import { setLang, t } from '../src/i18n.ts';
import ZH from '../src/i18n-zh-CN.ts';

const ARCANA = '"item_rarity"\t\t"arcana"';
const IMMORTAL = '"item_rarity"\t\t"immortal"';

test('an arcana reported with problems carries them, and a broken one says it is broken', () => {
  assert.deepEqual(itemNote(['razor'], ARCANA)?.status, 'issues');
  assert.match(itemNote(['razor'], ARCANA)!.note, /180°/);
  assert.equal(itemNote(['windrunner'], ARCANA)?.status, 'issues', 'Windranger by the id items_game gives her');
  assert.equal(itemNote(['pudge'], ARCANA)?.status, 'broken');
});

test('an arcana reported to work carries nothing, and one nobody has played says so', () => {
  assert.equal(itemNote(['queenofpain'], ARCANA), null);
  assert.equal(itemNote(['zuus'], ARCANA), null);
  assert.deepEqual(itemNote(['some_new_hero'], ARCANA), { status: 'untested', note: 'Не проверено в игре' });
});

test('an item that is no arcana carries nothing, and Io, played since, carries nothing either', () => {
  assert.equal(isArcanaBlock(IMMORTAL), false);
  assert.equal(itemNote(['razor'], IMMORTAL), null, "Razor's other items are not his arcana");
  assert.equal(itemNote(['wisp'], IMMORTAL), null);
  assert.equal(itemNote(['wisp'], ARCANA), null, 'Benevolent Companion works');
});

test('no hero is reported both ways, and every note reads in English and Chinese', () => {
  for (const hero of Object.keys(ARCANA_NOTES)) assert.equal(ARCANAS_THAT_WORK.has(hero), false, hero);
  const zh = ZH as Record<string, string | undefined>;
  try {
    setLang('en');
    for (const { note } of [...Object.values(ARCANA_NOTES), { note: 'Не проверено в игре' }]) {
      assert.notEqual(t(note), note, `no English for: ${note}`);
      assert.ok(zh[note], `no Chinese for: ${note}`);
    }
  } finally {
    setLang('ru');
  }
});

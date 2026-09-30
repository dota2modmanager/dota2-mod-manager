/* Two properties of the item table that nothing pinned, found by reading what a competitor
 * thought was worth testing about the same file.
 *
 * ArdysaModsTools works on the same items_game.txt and its suite has a case for a short id
 * matching inside a longer one, and a dozen for text hygiene - CRLF, smart quotes, non-breaking
 * spaces, zero-width characters, a byte order mark. Neither of those was covered here, and both
 * are cheap to be wrong about in ways nobody notices until a 50 MB file reaches the engine.
 *
 * The answers turned out to be good ones, so these tests exist to keep them that way rather
 * than to report a bug.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as schema from '../src/schema.ts';

/** A table whose ids are prefixes of each other, which is the trap. */
const collisionTable = [
  '"items_game"',
  '{',
  '\t"items"',
  '\t{',
  '\t\t"12"\n\t\t{\n\t\t\t"name"\t\t"twelve"\n\t\t}',
  '\t\t"123"\n\t\t{\n\t\t\t"name"\t\t"one two three"\n\t\t}',
  '\t\t"1234"\n\t\t{\n\t\t\t"name"\t\t"one two three four"\n\t\t}',
  '\t}',
  '}',
  '',
].join('\n');

test('an id that is the start of another id still finds its own block', () => {
  /* The whole file is text, and the lazy way to find item 12 is to look for "12" - which is
   * inside "123" and "1234" as well. Getting this wrong writes a mod's block over the wrong
   * item, in a file the engine loads for every match. */
  for (const [id, name] of [['12', 'twelve'], ['123', 'one two three'], ['1234', 'one two three four']]) {
    const found = schema.findItem(collisionTable, id);
    assert.ok(found, `no block for ${id}`);
    assert.match(found.text, new RegExp(`"${name}"`), `id ${id} matched the wrong block`);
    assert.match(found.text, new RegExp(`^"${id}"`), `block for ${id} does not open with that id`);
  }
});

test('an id the table does not have is missing, not the nearest thing to it', () => {
  assert.equal(schema.findItem(collisionTable, '99'), null);
  assert.equal(schema.findItem(collisionTable, '1'), null, 'a prefix of three real ids is not an id');
  assert.equal(schema.findItem(collisionTable, '12345'), null);
});

test('listing sees each of them once, in the order the file has them', () => {
  assert.deepEqual(schema.listItems(collisionTable).map((i) => i.id), ['12', '123', '1234']);
});

// ---------- what happens to bytes a mod author's editor added ----------

const base = '"items_game"\n{\n\t"items"\n\t{\n\t\t"12"\n\t\t{\n\t\t\t"name"\t\t"vanilla"\n\t\t}\n\t}\n}\n';
const merged = (block: string) => schema.mergeSchema(base, [{ id: '12', block, source: 'mod' }]);

test('a block a text editor gave CRLF endings still lands', () => {
  const r = merged('"12"\r\n{\r\n\t"name"\t\t"patched"\r\n}');
  assert.equal(r.applied.length, 1);
  assert.match(r.text, /"patched"/);
});

test('a byte order mark in front of a block does not stop it matching its id', () => {
  /* Editors on Windows add one without asking. It sits before the opening quote, so a matcher
   * anchored on that quote would decide the block is malformed and drop the mod silently. */
  const r = merged('﻿"12"\n{\n\t"name"\t\t"patched"\n}');
  assert.equal(r.applied.length, 1, 'a leading BOM must not lose the block');
  assert.match(r.text, /"patched"/);
});

test('what a mod ships is written through byte for byte, oddities included', () => {
  /* The module says so at the top of the file: latin1 in, latin1 out, no re-encoding
   * surprises, because the real table is ~50 MB with non-UTF8 bytes in it and a round trip
   * through a "cleaner" representation is how those get mangled.
   *
   * The cost is that a smart quote or a non-breaking space in somebody's block reaches the
   * engine as they wrote it. That is deliberate: normalising would mean editing a mod's own
   * content, and a curly quote inside a display string is legitimate. Pinned here so the
   * trade-off is a decision on record rather than an accident. */
  const smart = merged('"12"\n{\n\t"name"\t\t“patched”\n}');
  assert.match(smart.text, /“patched”/, 'curly quotes survive unchanged');

  const nbsp = merged('"12"\n{\n\t"name"\t\t"pat ched"\n}');
  assert.match(nbsp.text, /pat ched/, 'a non-breaking space survives unchanged');
});

test('the same block from two mods is one edit, whatever whitespace they used', () => {
  /* Already covered for identical text; this is the variant that matters in practice, because
   * two exports of the same cart differ only in indentation. */
  const r = schema.mergeSchema(base, [
    { id: '12', block: '"12"\n{\n\t"name"\t\t"patched"\n}', source: 'mod A' },
    { id: '12', block: '"12"\r\n{\r\n    "name"  "patched"\r\n}', source: 'mod B' },
  ]);
  assert.deepEqual(r.conflicts, [], 'the same block written two ways is not two mods disagreeing');
});

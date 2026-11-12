/**
 * /catalog/data.json against its published description (docs/catalog-data.md and
 * docs/catalog-data.schema.json, issue #435). Other people's bots and sites read this file, so a
 * field that moves breaks code we never see. The check walks the schema's own prefixItems, so the
 * schema and this test cannot drift apart.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST } from './harness.mjs';

const data = JSON.parse(fs.readFileSync(path.join(DIST, 'catalog', 'data.json'), 'utf-8'));
const schema = JSON.parse(fs.readFileSync(new URL('../../docs/catalog-data.schema.json', import.meta.url), 'utf-8'));
const doc = fs.readFileSync(new URL('../../docs/catalog-data.md', import.meta.url), 'utf-8');

/** Why value does not fit the one-field schema s, or null when it does. */
function misfit(value, s) {
  if ('const' in s && value !== s.const) return `is ${JSON.stringify(value)}, not ${s.const}`;
  if (s.enum && !s.enum.includes(value)) return `${JSON.stringify(value)} is not one of ${s.enum.join(', ')}`;
  if (s.type === 'string' && typeof value !== 'string') return `is not a string`;
  if (s.type === 'string' && s.minLength && value.length < s.minLength) return `is empty`;
  if (s.type === 'integer' && !Number.isInteger(value)) return `is not an integer`;
  if (s.type === 'integer' && 'minimum' in s && value < s.minimum) return `is below ${s.minimum}`;
  if (s.type === 'array' && !Array.isArray(value)) return `is not an array`;
  if (s.type === 'array' && s.items && value.some((v) => misfit(v, s.items))) return `holds an item of the wrong type`;
  return null;
}

/** Every problem in a list of rows against the schema of one row. */
function rowProblems(name, rows, rowSchema) {
  const problems = [];
  rows.forEach((row, i) => {
    if (row.length < rowSchema.minItems) problems.push(`${name}[${i}] has ${row.length} fields, wants ${rowSchema.minItems}`);
    rowSchema.prefixItems.forEach((field, f) => {
      const why = misfit(row[f], field);
      if (why) problems.push(`${name}[${i}].${field.title} ${why}`);
    });
  });
  return problems;
}

test('data.json has the format version the doc describes', () => {
  assert.equal(misfit(data.v, schema.properties.v), null);
  assert.deepEqual(Object.keys(data).sort(), [...schema.required].sort());
});

for (const part of ['cats', 'heroes', 'mods', 'adult']) {
  test(`every row of ${part} fits the schema`, () => {
    assert.deepEqual(rowProblems(part, data[part], (schema.properties[part].items.$ref ? schema.properties.mods.items : schema.properties[part].items)).slice(0, 10), []);
  });
}

test('indexes in a mod row point at a category and a hero that exist', () => {
  const bad = data.mods.filter((m) => !data.cats[m[2]] || (m[3] !== -1 && !data.heroes[m[3]]));
  assert.deepEqual(bad.map((m) => m[0]).slice(0, 10), []);
});

test('mod keys are unique, as the doc promises', () => {
  const keys = data.mods.map((m) => m[0]);
  assert.equal(new Set(keys).size, keys.length);
});

test('the doc names every mod field in the schema, in order', () => {
  const titles = schema.properties.mods.items.prefixItems.map((f) => f.title);
  assert.ok(doc.includes(`[${titles.join(', ')}]`), `docs/catalog-data.md should show [${titles.join(', ')}]`);
  titles.forEach((t, i) => assert.ok(doc.includes(`| ${i} | \`${t}\` |`), `docs/catalog-data.md lacks row ${i} ${t}`));
});

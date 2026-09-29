/* The incident write-ups in docs/incidents/ each end with what now stops that break from coming
 * back: a file, and often one test or one workflow step by its title. A write-up whose guard was
 * renamed or deleted still reads as reassurance, for a hole that is open again. So every name in
 * those sections is held to the repository as it is, and the index to the folder.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'incidents');
const FIELDS = ['Date', 'Versions', 'Fixed in', 'Impact'];
const SECTIONS = ['What happened', 'Why', 'Why nothing caught it', 'What catches it now'];

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();

function parse(name) {
  const text = read(path.join(DIR, name));
  const fields = {};
  for (const m of text.matchAll(/^\| ([^|]+?) \| (.+?) \|$/gm)) fields[m[1]] = m[2];
  const catches = text.split(/^## What catches it now$/m)[1] || '';
  // a bullet runs until the next one, over indented continuation lines
  const guards = catches.split(/\n(?=- )/)
    .map((b) => flat(b).trim())
    .filter((b) => b.startsWith('- '))
    .map((bullet) => {
      const m = bullet.match(/^- `([^`]+)`(?: "([^"]+)")?/);
      return { bullet, file: m && m[1], title: m && m[2] };
    });
  return {
    title: (text.match(/^# (.+)$/m) || [])[1],
    fields,
    sections: [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]),
    guards,
  };
}

/** Every test title in a file, the way node:test will print it. */
function testTitles(text) {
  const titles = [];
  const re = /\btest\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;
  for (const m of text.matchAll(re)) titles.push((m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1'));
  return titles;
}

test('there are incidents to hold', () => {
  assert.ok(files.length >= 7, `only ${files.length} write-ups in docs/incidents`);
});

test('each write-up has a title, its four fields and its four sections, in order', () => {
  for (const name of files) {
    const { title, fields, sections } = parse(name);
    assert.ok(title, `${name} has no title`);
    for (const field of FIELDS) assert.ok(fields[field] && fields[field].trim(), `${name} has no ${field}`);
    assert.match(fields.Date, /^\d{4}-\d{2}-\d{2}$/, `${name}: the date is not YYYY-MM-DD`);
    assert.ok(name.startsWith(`${fields.Date}-`), `${name} is not named after the day it was found (${fields.Date})`);
    assert.deepEqual(sections, SECTIONS, `${name} has the wrong sections`);
    if (fields.Issue) assert.match(fields.Issue, /^#\d+(, #\d+)*$/, `${name}: the radar reads the Issue row as "#12" or "#12, #14"`);
  }
});

test('every guard a write-up names is still in the repository, under the title it gives', () => {
  const problems = [];
  for (const name of files) {
    const { guards } = parse(name);
    if (!guards.length) problems.push(`${name}: names nothing that catches it now`);
    for (const g of guards) {
      if (!g.file) { problems.push(`${name}: a bullet does not start with a path in backticks: ${g.bullet.slice(0, 80)}`); continue; }
      const full = path.join(ROOT, g.file);
      if (!fs.existsSync(full)) { problems.push(`${name}: ${g.file} is not in the repository`); continue; }
      if (!g.title) continue;
      const text = read(full);
      if (/\.test\.js$/.test(g.file)) {
        if (!testTitles(text).includes(g.title)) problems.push(`${name}: ${g.file} has no test called "${g.title}"`);
      } else if (!flat(text).includes(g.title)) {
        problems.push(`${name}: ${g.file} no longer says "${g.title}"`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('every write-up names at least one test or workflow among its guards', () => {
  /* A comment in the fixed file explains the fix. It does not fail when the fix is undone. */
  for (const name of files) {
    const kinds = parse(name).guards.map((g) => g.file || '');
    assert.ok(kinds.some((f) => /^test\/|^\.github\/workflows\/|^site\/tools\//.test(f)), `${name} names nothing that runs`);
  }
});

test('the committed incident index is exactly what the generator produces', () => {
  const generator = require('../tools/gen-incidents');
  const expected = generator.build();
  const actual = read(path.join(DIR, 'README.md'));

  assert.equal(actual, expected, 'docs/incidents/README.md is out of date. Run: npm run docs');
});

test('the test-title reader sees the titles node:test prints', () => {
  const titles = testTitles([
    "test('plain', () => {});",
    'test("Valve\'s own line", () => {});',
    "test('it\\'s escaped', async (t) => {});",
    'test(`a template`, () => {});',
    "notATest('skipped', () => {});",
  ].join('\n'));
  assert.deepEqual(titles, ['plain', "Valve's own line", "it's escaped", 'a template']);
});

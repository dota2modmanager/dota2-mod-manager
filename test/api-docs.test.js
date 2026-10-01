// docs/API.md is generated from the source, and this is what makes that mean something:
// if somebody changes a comment or an export and does not regenerate, CI says so.
//
// The project has shipped stale documentation before - a README naming one platform weeks
// after the second build started going out, a comment claiming a folder was six megabytes
// when it was forty-five. Generated-and-checked is the only kind that stays true, so the
// reference is not a file somebody maintains; it is a file the tests maintain.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'API.md');
const { build, moduleDoc } = require('../tools/gen-api-docs.js');

/* Windows checks the file out with CRLF, CI reads it with LF, and the generator emits LF.
 * Comparing the raw bytes would fail on one platform and pass on the other, which is a test
 * that reports the checkout rather than the code. */
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

test('the committed reference is what the source says today', () => {
  assert.ok(fs.existsSync(OUT), 'docs/API.md exists');
  assert.equal(read(OUT), build(), 'docs/API.md is out of date. Run: npm run docs');
});

test('every module that ships is in the reference', () => {
  const text = read(OUT);
  const skipped = (f) => f.startsWith('ipc-') || /^(settings-view|uninstall-window)\.[jt]s$/.test(f);
  const files = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts'));
  assert.ok(files.length > 20, 'src/ was found');
  for (const f of files.filter((f) => !skipped(f))) {
    assert.ok(text.includes(`## src/${f}`), `${f} has a section`);
  }
  for (const f of files.filter(skipped)) {
    assert.ok(!text.includes(`## src/${f}`), `${f} is wiring, not API`);
  }
});

test('a TypeScript module is read by its export statements, its opening comment first', () => {
  const doc = moduleDoc('sample.ts', [
    '// What this module is for,',
    '// in two lines.',
    "import { x } from './x.ts';",
    '',
    '/** The first export, with a comment of its own. */',
    'export const FIRST: number = 1;',
    'export interface Shape { a: number }',
    '/** Called with a type parameter. */',
    'export function pick<T>(list: T[]): T {',
    '  return list[0];',
    '}',
    'export class Box {}',
    'const hidden = 2;',
    'const late = 3;',
    'export { hidden as shown, late };',
  ].join('\n'));
  assert.equal(doc.header, 'What this module is for,\nin two lines.', 'the opening comment, not the first export\'s');
  assert.deepEqual(doc.items.map((it) => it.name), ['FIRST', 'Shape', 'pick', 'Box', 'shown', 'late'], 'types are listed too');
  assert.equal(doc.items[1].sig, 'export interface Shape { a: number }');
  assert.equal(doc.items[2].sig, 'export function pick<T>(list: T[]): T');
  assert.equal(doc.items[2].doc, 'Called with a type parameter.');
  assert.equal(doc.lang, 'ts');
});

test('a JavaScript module is read by its module.exports list, a renamed entry under its public name', () => {
  // no module in src/ is written this way any more, but the reader still is, for as long as one could be
  const doc = moduleDoc('old.js', [
    '// What this module was for.',
    'function first() {}',
    '/** The second, with a comment. */',
    'function second() {}',
    'module.exports = {',
    '  first, // the plain one',
    '  public: second,',
    '};',
  ].join('\n'));
  assert.deepEqual(doc.items.map((it) => it.name), ['first', 'public']);
  assert.equal(doc.lang, 'js');
  assert.equal(doc.header, 'What this module was for.');
});

test('a module that hands on names from another points there instead of counting them as gaps', () => {
  const doc = moduleDoc('door.ts', [
    '// The door everything comes through.',
    "export { read, list } from './door-read.ts';",
    "export type { Entry } from './door-read.ts';",
    "export {\n  build,\n} from './door-write.ts';",
  ].join('\n'));
  assert.deepEqual(doc.items, [], 'nothing of its own');
  assert.deepEqual(doc.reexports, [
    { from: 'door-read.ts', names: ['read', 'list', 'Entry'] },
    { from: 'door-write.ts', names: ['build'] },
  ]);
});

/* A ratchet, not a target. Every export with no comment above it is a gap in the source, and
 * this number is only ever allowed to go down: lower it when you document something, never
 * raise it to make a new undocumented export fit. */
const UNDOCUMENTED_CEILING = 45;

test('the number of exports nobody has explained does not grow', () => {
  const text = read(OUT);
  const bare = (text.match(/^_No description in the source\._$/gm) || []).length;
  assert.ok(
    bare <= UNDOCUMENTED_CEILING,
    `${bare} exports have no comment in the source, and the ceiling is ${UNDOCUMENTED_CEILING}. `
    + 'Write the comment rather than raising the number.',
  );
});

/* The ratchet in tools/typecheck.mjs: the number of type errors may go down, never up.
 *
 * The same shape as the coverage floor. `tsc --checkJs` reports sixty-odd places where a factory's
 * @param lists half of what it is handed, or an object literal is filled in later. Fixing them all
 * at once would be one unreviewable change across fifteen files, and leaving the tool out until
 * then would mean the next one is found by a user. So the count per file is written down, and a run
 * fails when any file grows or a clean file starts reporting.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const load = () => import('../tools/typecheck.mjs');

test('tsc output becomes a count per file', async () => {
  const { parse } = await load();
  const out = [
    "src/a.js(12,3): error TS2339: Property 'x' does not exist on type '{}'.",
    "src/a.js(40,9): error TS2345: Argument of type 'string' is not assignable to parameter.",
    'main.js(1,1): error TS2554: Expected 1 arguments, but got 2.',
    'Found 3 errors in 2 files.',
  ].join('\n');
  assert.deepEqual(parse(out), { total: 3, files: { 'src/a.js': 2, 'main.js': 1 } });
});

test('a Windows path is the same file as its posix spelling', async () => {
  // the Windows job runs this too, and a baseline keyed by backslashes would match nothing there
  const { parse } = await load();
  assert.deepEqual(parse('src\\a.js(1,1): error TS2339: x').files, { 'src/a.js': 1 });
});

test('nothing but an error line counts', async () => {
  const { parse } = await load();
  const noise = [
    'src/a.js(3,1): warning TS6133: unused',
    "Property 'x' does not exist on type '{}'.",
    '',
  ].join('\n');
  assert.deepEqual(parse(noise), { total: 0, files: {} });
});

test('more errors in a file fails; fewer passes and asks for the baseline to drop', async () => {
  const { compare } = await load();
  const baseline = { files: { 'src/a.js': 2, 'src/b.js': 1 } };

  const grown = compare(baseline, { files: { 'src/a.js': 3, 'src/b.js': 1 } });
  assert.deepEqual(grown.worse, ['src/a.js: 3 errors, 2 allowed']);

  const shrunk = compare(baseline, { files: { 'src/a.js': 1 } });
  assert.deepEqual(shrunk.worse, []);
  assert.deepEqual(shrunk.better, ['src/a.js: 1, was 2']);
  assert.deepEqual(shrunk.gone, ['src/b.js: clean, was 1']);
});

test('a file that was clean and now reports fails', async () => {
  const { compare } = await load();
  assert.deepEqual(
    compare({ files: { 'src/a.js': 2 } }, { files: { 'src/a.js': 2, 'src/new.js': 1 } }).worse,
    ['src/new.js: 1 errors, 0 allowed'],
  );
});

test('the committed baseline is a measurement, not a wish', async () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'typecheck-baseline.json'), 'utf8'));
  assert.match(b.measured, /^\d{4}-\d{2}-\d{2}$/, 'the baseline does not say when it was measured');
  const sum = Object.values(b.files).reduce((a, n) => a + n, 0);
  assert.equal(sum, b.total, 'the total and the per-file numbers disagree');
  for (const [file, n] of Object.entries(b.files)) {
    assert.ok(Number.isInteger(n) && n > 0, `${file}: ${n} is not a count of errors`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is in the baseline and not in the repository`);
  }
});

test('a failing file names the project that reads it', async () => {
  // since the main process moved to TypeScript, the root project checks the two preloads only
  const { projectFor } = await load();
  assert.equal(projectFor('src/main.ts'), 'src/tsconfig.json');
  assert.equal(projectFor('test/vpk.test.ts'), 'test/tsconfig.json');
  assert.equal(projectFor('preload.js'), 'tsconfig.json');
});

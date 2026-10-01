/* The size budget in tools/size-budget.mjs: the big files may shrink, not grow.
 *
 * Five files carry 7 155 lines between them while the median module in src/ is 171. None of them
 * arrived that size; each grew a hundred lines at a time with nobody deciding to. The budget is
 * the decision, and these tests are its judgement: what counts as over, what counts as progress,
 * and that an update can never quietly raise a number.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const load = () => import('../tools/size-budget.mjs');

test('lines are counted the way wc -l counts them', async () => {
  const { countLines } = await load();
  assert.equal(countLines('a\nb\nc\n'), 3, 'a trailing newline does not start a line');
  assert.equal(countLines('a\nb\nc'), 3, 'and a missing one does not lose the last');
  assert.equal(countLines(''), 0);
});

test('a budgeted file that grew is over; one that shrank is progress', async () => {
  const { compare } = await load();
  const budget = { 'src/big.js': 1000, 'main.js': 1300 };
  const r = compare(budget, { 'src/big.js': 1001, 'main.js': 1200 }, 800);
  assert.deepEqual(r.over, ['src/big.js: 1001 lines, budget 1000']);
  assert.deepEqual(r.shrunk, ['main.js: 1200 lines, budget 1300']);
});

test('a file nobody budgeted announces itself at the watch mark', async () => {
  /* This is how a sixth outlier has to arrive: by being added to the file on purpose, rather than
     by growing past the others while nobody was counting. */
  const { compare } = await load();
  const r = compare({}, { 'src/new.js': 801, 'src/fine.js': 799 }, 800);
  assert.deepEqual(r.over, ['src/new.js: 801 lines, over the 800-line watch mark and not in the budget']);
  assert.deepEqual(r.shrunk, []);
});

test('a budgeted file that was deleted or renamed is reported, not ignored', async () => {
  const { compare } = await load();
  const r = compare({ 'src/gone.js': 900 }, { 'main.js': 100 }, 800);
  assert.deepEqual(r.gone, ['src/gone.js: no longer there, budget 900']);
});

test('an update lowers a number and refuses to raise one', async () => {
  /* Without this the ratchet is a suggestion: one --update after a careless week and the budget
     is wherever the code happens to be. */
  const { tighten } = await load();
  const budget = { 'src/big.js': 1000, 'main.js': 1300 };
  const { next, refused } = tighten(budget, { 'src/big.js': 1200, 'main.js': 1100 });
  assert.equal(next['src/big.js'], 1000, 'a file that grew keeps its old budget');
  assert.equal(next['main.js'], 1100, 'a file that shrank gets the smaller number');
  assert.deepEqual(refused, ['src/big.js: 1200 lines, budget stays 1000']);
});

test('an update picks up a new file only once it passes the watch mark', async () => {
  const { tighten, WATCH_AT } = await load();
  const { next } = tighten({}, { 'src/small.js': 120, 'src/large.js': WATCH_AT + 1 });
  assert.deepEqual(Object.keys(next), ['src/large.js']);
});

test('the app files it watches are the ones that ship', async () => {
  const { appFiles } = await load();
  const files = appFiles();
  assert.ok(files.includes('main.js') && files.includes('preload.js'));
  assert.ok(files.some((f) => f.startsWith('src/')) && files.some((f) => f.startsWith('renderer/')));
  assert.ok(!files.some((f) => f.startsWith('test/') || f.startsWith('tools/')),
    'tests and tools are not shipped and are not budgeted');
});

test('the committed budget is a measurement of files that are there', async () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'size-budget.json'), 'utf8'));
  assert.match(b.measured, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(b.watchAt) && b.watchAt > 0);
  for (const [file, lines] of Object.entries(b.files)) {
    assert.ok(Number.isInteger(lines) && lines > 0, `${file}: ${lines} is not a line count`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is budgeted and not in the repository`);
  }
});

test('a component in a folder of its own is counted, in TypeScript as much as JavaScript', async () => {
  /* The window moves to one component per file, in folders per screen. A walk of four fixed
     folders and *.js would have waved every one of them through at any size. */
  const { appFiles } = await load();
  const tree = {
    src: ['a.js'],
    renderer: ['app.js', 'catalog/', 'public/'],
    'renderer/catalog': ['Grid.tsx', 'filters.ts', 'cards/'],
    'renderer/catalog/cards': ['Card.tsx', 'card.css'],
    'renderer/public': ['assets/'],
    'renderer/public/assets': ['x.js'],
  };
  const dirent = (name) => ({ name: name.replace(/\/$/, ''), isDirectory: () => name.endsWith('/') });
  const readdir = (full) => {
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    return (tree[rel] || []).map(dirent);
  };
  const files = appFiles(readdir, () => true);
  for (const f of ['renderer/catalog/Grid.tsx', 'renderer/catalog/filters.ts', 'renderer/catalog/cards/Card.tsx', 'src/a.js']) {
    assert.ok(files.includes(f), `${f} is not budgeted`);
  }
  assert.ok(!files.some((f) => f.startsWith('renderer/public/')), 'pictures copied as they are are not code');
  assert.ok(!files.some((f) => f.endsWith('.css')));
});

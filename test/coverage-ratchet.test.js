/* The coverage ratchet in tools/coverage.mjs: per file, and only where it was measured.
 *
 * The floor used to be three numbers on the command line. An aggregate hides what is worth
 * catching: on 2026-09-16 it read 76.10% while src/presets-service.ts sat at 13.8%, and a new
 * module with no tests moves the aggregate by a fraction of a point. These hold the parsing and
 * the comparison, which is all of the judgement; running the suite is node's job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const load = () => import('../tools/coverage.mjs');

const LCOV = [
  'TN:',
  'SF:src/a.js',
  'FNF:4', 'FNH:2',
  'BRF:10', 'BRH:5',
  'LF:100', 'LH:80',
  'end_of_record',
  'TN:',
  'SF:src/b.js',
  'FNF:2', 'FNH:2',
  'BRF:4', 'BRH:4',
  'LF:50', 'LH:25',
  'end_of_record',
].join('\n');

test('lcov becomes hit and found counts per file', async () => {
  const { parseLcov } = await load();
  const { files } = parseLcov(LCOV);
  assert.deepEqual(Object.keys(files), ['src/a.js', 'src/b.js']);
  assert.deepEqual(files['src/a.js'], { lines: [80, 100], functions: [2, 4], branches: [5, 10] });
});

test('nothing to cover counts as covered, so an empty file cannot fail a run', async () => {
  const { pct } = await load();
  assert.equal(pct(0, 0), 100);
  assert.equal(pct(1, 4), 25);
});

test('the aggregate is over counts, not an average of percentages', async () => {
  // 105 of 150 lines is 70%, where averaging 80% and 50% would say 65% and be wrong about it
  const { parseLcov, aggregate } = await load();
  const agg = aggregate(parseLcov(LCOV).files);
  assert.equal(agg.lines.toFixed(2), '70.00');
  assert.equal(agg.functions.toFixed(2), '66.67');
  assert.equal(agg.branches.toFixed(2), '64.29');
});

test('a file that loses coverage fails, and one that gains asks for its line to be raised', async () => {
  const { parseLcov, compare } = await load();
  const now = parseLcov(LCOV);
  const baseline = {
    platform: process.platform,
    global: { lines: 60, functions: 60, branches: 60 },
    files: { 'src/a.js': { lines: 90 }, 'src/b.js': { lines: 40 } },
  };
  const r = compare(baseline, now, { perFile: true });
  assert.deepEqual(r.worse, ['src/a.js: 80.0% of lines, floor 90.0%']);
  // the aggregate is above its floor here, so it is reported as better too; the per-file line is
  // the one this case is about
  assert.ok(r.better.includes('src/b.js: 50.0% of lines, was 40.0%'), r.better.join(' | '));
});

test('re-measuring is only advised when re-measuring would change something', async () => {
  /* --update writes the per-file lines back and leaves the aggregate floor where it is, which
     is the design: the floor sits under both platforms so it stays a floor. Advising --update
     because the aggregate is above that floor asked for a command that changes nothing, and
     the same advice came back on the next run and every run after it. */
  const { worthUpdating } = await load();
  assert.equal(worthUpdating(['all files: lines 77.07%, was 74.00%']), false);
  assert.equal(worthUpdating([]), false);
  assert.equal(
    worthUpdating(['all files: lines 77.07%, was 74.00%', 'src/b.js: 50.0% of lines, was 40.0%']),
    true,
    'a file that gained coverage is exactly what --update is for',
  );
});

test('a file that stops being measured is a failure, not a pass', async () => {
  /* Node reports only files a test loaded. Deleting the last test that touches a module would
     otherwise make it disappear from the report and look like nothing happened. */
  const { parseLcov, compare } = await load();
  const baseline = {
    platform: process.platform,
    global: { lines: 60, functions: 60, branches: 60 },
    files: { 'src/a.js': { lines: 80 }, 'src/gone.js': { lines: 70 } },
  };
  const r = compare(baseline, parseLcov(LCOV), { perFile: true });
  assert.deepEqual(r.gone, ['src/gone.js: no longer measured, was 70.0% of its lines']);
});

test('half a point of rounding is not a failure', async () => {
  const { parseLcov, compare } = await load();
  const baseline = {
    platform: process.platform,
    global: { lines: 60, functions: 60, branches: 60 },
    files: { 'src/a.js': { lines: 80.4 }, 'src/b.js': { lines: 50 } },
  };
  assert.deepEqual(compare(baseline, parseLcov(LCOV), { perFile: true }).worse, []);
});

test('the aggregate floor is held on every platform, per-file only where it was measured', async () => {
  const { parseLcov, compare } = await load();
  const now = parseLcov(LCOV);
  const baseline = {
    platform: 'someone-elses-machine',
    global: { lines: 75, functions: 60, branches: 60 },
    files: { 'src/a.js': { lines: 99 } },
  };
  const elsewhere = compare(baseline, now, { perFile: false });
  assert.deepEqual(elsewhere.worse, ['all files: lines 70.00%, floor 75.00%'],
    'the aggregate floor is a floor everywhere');
  const here = compare(baseline, now, { perFile: true });
  assert.ok(here.worse.some((w) => w.startsWith('src/a.js')), 'and per-file holds where it was measured');
});

test('each platform is held against its own numbers, and one nobody measured against none', async () => {
  /* A line measured on one machine is not evidence about another, but it is evidence about that
     machine, and until 2026-09-16 only one of them was held to anything. */
  const { filesFor } = await load();
  const baseline = { global: {}, platforms: { win32: { files: { 'src/a.js': { lines: 80 } } } } };

  assert.deepEqual(filesFor(baseline, 'win32'), { 'src/a.js': { lines: 80 } });
  assert.equal(filesFor(baseline, 'linux'), null,
    'a platform nobody has measured would be held to somebody else\'s lines');
  // the shape the file had first: one platform's numbers at the top level
  assert.deepEqual(
    filesFor({ platform: 'linux', files: { 'src/b.js': { lines: 50 } } }, 'linux'),
    { 'src/b.js': { lines: 50 } },
  );
});

test('measuring on one machine leaves every other machine\'s numbers alone', async () => {
  /* Otherwise one --update on a laptop disarms the per-file half of the ratchet on CI, and the
     file still looks like a full measurement afterwards. */
  const { nextBaseline } = await load();
  const previous = {
    global: { lines: 74 },
    platforms: { linux: { measured: '2026-09-01', files: { 'src/a.js': { lines: 90 } } } },
  };

  const next = nextBaseline(previous, {
    platform: 'win32', measured: '2026-09-16', files: { 'src/a.js': { lines: 70 } }, global: { lines: 74 },
  });

  assert.deepEqual(next.platforms.linux, previous.platforms.linux, 'the other platform was rewritten');
  assert.deepEqual(next.platforms.win32.files, { 'src/a.js': { lines: 70 } });
  assert.deepEqual(Object.keys(next.platforms), ['linux', 'win32'], 'the order is stable, so a diff is readable');

  // a file still in the first shape is carried into the map rather than dropped on the floor
  const migrated = nextBaseline(
    { platform: 'linux', measured: '2026-09-01', files: { 'src/b.js': { lines: 60 } }, global: {} },
    { platform: 'win32', measured: '2026-09-16', files: {}, global: {} },
  );
  assert.deepEqual(migrated.platforms.linux.files, { 'src/b.js': { lines: 60 } });
});

test('the committed baseline is a measurement, not a wish', async () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'coverage-baseline.json'), 'utf8'));
  for (const kind of ['lines', 'functions', 'branches']) {
    assert.ok(typeof b.global[kind] === 'number', `the floor has no ${kind}`);
  }
  assert.ok(b.platforms && Object.keys(b.platforms).length, 'the baseline names no platform it was measured on');
  for (const [platform, entry] of Object.entries(b.platforms)) {
    assert.match(entry.measured, /^\d{4}-\d{2}-\d{2}$/, `${platform} does not say when it was measured`);
    for (const [file, line] of Object.entries(entry.files)) {
      assert.ok(typeof line.lines === 'number' && line.lines >= 0 && line.lines <= 100,
        `${platform} ${file}: ${line.lines} is not a percentage`);
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is in the ${platform} baseline and not in the repository`);
    }
  }
});

// DECISIONS.md, held to the repository it describes.
//
// That file answers reviews with numbers - how long the main process's entry file is, how many
// test files there are, what the app depends on - and its whole argument is that a claim with a
// check next to it beats a claim without one. A document like that going stale is worse than not
// having written it: the next reviewer runs one command, finds it disagrees, and stops trusting
// the rest.
//
// So the countable claims are asserted here. Every failure message carries the current value, so
// fixing one is copying a number across rather than going to find it.
//
// Deliberately not asserted: the "last gone over" date and the version beside it. Those record
// when a person read the whole file, and a test that kept them current would be forging a review
// nobody did. Same for the prose - no test can tell whether "the interval is not lowered" is
// still the decision.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'DECISIONS.md'), 'utf-8');

/** How many lines a file in the repository has, counted the way `wc -l` counts them. */
const lineCount = (file) => fs.readFileSync(path.join(root, file), 'utf-8').split('\n').length - 1;

test('the line count it gives for the main process is roughly the line count src/main.ts has', () => {
  /* "About 1,300" rather than an exact figure, and within a tenth rather than to the line. The
     claim being answered is "3,100 line monolith", which a rounded number settles just as well -
     and an exact one turns every edit to the entry file into a documentation chore, which is how the
     co-author count in this file came to fail a build for no reason anybody cared about. */
  const real = lineCount('src/main.ts');
  const claimed = doc.match(/`src\/main\.ts`, about ([\d,]+) lines/);
  assert.ok(claimed, 'the corrections table no longer carries a line count for the main process');
  const said = Number(claimed[1].replace(/,/g, ''));
  assert.ok(
    Math.abs(said - real) <= real / 10,
    `DECISIONS.md says about ${claimed[1]} lines, src/main.ts has ${real.toLocaleString('en-US')}`,
  );
});

test('there are at least as many test files as the table claims', () => {
  // A floor, not a count. It answers "there are 25 test files" without needing an edit every
  // time somebody adds one, which happened three times in a day and failed the build each time.
  const real = fs.readdirSync(path.join(root, 'test')).filter((f) => /\.test\.(js|ts)$/.test(f)).length;
  const claimed = doc.match(/More than (\d+) of them, run on/);
  assert.ok(claimed, 'the corrections table no longer carries a test file count');
  assert.ok(real > Number(claimed[1]), `DECISIONS.md says more than ${claimed[1]} test files, test/ holds ${real}`);
});

test('the dependencies it names are the dependencies package.json declares', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
  const ships = Object.keys(pkg.dependencies ?? {});
  const builds = Object.keys(pkg.devDependencies ?? {});

  // The entry names every one of them and says which two reach a user's machine. One more
  // arriving without the paragraph changing is exactly the drift this catches.
  for (const name of [...ships, ...builds]) {
    assert.ok(doc.includes(`\`${name}\``), `DECISIONS.md does not mention the dependency ${name}`);
  }
  assert.equal(ships.length, 2, `the entry says the app ships two dependencies, package.json declares ${ships.length}`);
  assert.equal(builds.length, 12, `the entry says twelve devDependencies in all, package.json declares ${builds.length}`);
});

test('the fingerprint index is fetched from the branch the entry says the catalog job writes', () => {
  // The entry says the job commits to catalog-data and the app reads from there. If the URL moves
  // again, the entry is describing a branch nothing reads.
  const { FP_URL } = require('../src/fingerprints.ts');
  assert.match(FP_URL, /\/catalog-data\/fingerprints\.json$/, `src/fingerprints.ts now fetches ${FP_URL}`);
  assert.ok(doc.includes('`FP_URL`'), 'the entry no longer points at the constant that proves it');
  const job = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'fingerprints.yml'), 'utf8');
  assert.match(job, /ref: catalog-data/, 'the catalog job no longer checks out the branch the app reads');
});

test('the three places that say how this is written still say it', () => {
  /* The entry's whole point is that nobody should have to guess, and a claim like that is only
     worth anything while all three places agree. They did not once before: AGENTS.md asked
     contributors to leave the trailer off while DECISIONS.md called the practice "stated rather
     than hidden". */
  for (const file of ['README.md', 'README.ru.md']) {
    const text = fs.readFileSync(path.join(root, file), 'utf-8');
    assert.ok(text.includes('Claude Code'), `${file} no longer says what this is written with`);
  }
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf-8');
  assert.ok(/Co-Authored-By/.test(agents), 'AGENTS.md no longer mentions the trailer it asks for');
  assert.ok(!/No `Co-Authored-By`/.test(agents), 'AGENTS.md is back to asking for no trailer');
  assert.ok(doc.includes('Claude Code'), 'DECISIONS.md no longer carries the entry');
});

test('the mirror named in the decisions is the mirror the READMEs point at', () => {
  // The Codeberg failure in one line: the decision to leave was made in the morning and both
  // READMEs went on advertising the mirror all day, so a reviewer that evening praised the
  // project for a second home it had already abandoned. The address now lives in three files,
  // and three copies of a fact drift the moment one of them is edited alone.
  const url = doc.match(/https:\/\/gitlab\.com\/[\w.-]+\/[\w.-]+/);
  assert.ok(url, 'DECISIONS.md no longer names a mirror; if the project moved, update all three');
  for (const file of ['README.md', 'README.ru.md']) {
    const text = fs.readFileSync(path.join(root, file), 'utf-8');
    assert.ok(text.includes(url[0]), `${file} does not point at ${url[0]}`);
  }
});

test('every entry offers a way to check it', () => {
  // The file's promise is one check per entry. A new entry added without one is the failure this
  // catches, because that entry is then just an assertion in a document full of evidence.
  const sections = doc.split(/^## /m).filter((s) => !s.startsWith('Claims that keep coming back'));
  for (const section of sections) {
    const entries = section.split(/^### /m).slice(1);
    for (const entry of entries) {
      const title = entry.split('\n')[0];
      assert.ok(/^\*Check:\*/m.test(entry) || /```/.test(entry), `no check under "${title}"`);
    }
  }
});

test('the corrections table gives a command for every claim it answers', () => {
  const table = doc.split('## Claims that keep coming back')[1] ?? '';
  const rows = table.split('\n').filter((l) => l.startsWith('| "'));
  assert.ok(rows.length >= 5, 'the corrections table lost most of its rows');
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    assert.ok(cells[3] && cells[3].length > 3, `no check in the row for ${cells[1]}`);
  }
});

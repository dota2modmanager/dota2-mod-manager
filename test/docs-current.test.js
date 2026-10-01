/* The documents, held to the repository they describe.
 *
 * `test/decisions.test.js` already pins the countable claims in DECISIONS.md. This is the wider
 * net, and it exists because of what a read-through on 2026-09-10 turned up: DECISIONS.md had an
 * entry headed "There is no linter and no formatter" three paragraphs above the entry explaining
 * why eslint had been added that morning, CONTRIBUTING.md said the same thing, ARCHITECTURE.md
 * put "every IPC handler" in main.js four days after they moved out of it, and the test-file
 * count was off by twenty.
 *
 * None of that needs a person to notice. A path that no longer exists, a script that was
 * renamed, a link to a deleted file and a claim the package contradicts are all machine-checkable,
 * so they are checked here rather than trusted to the next read-through.
 *
 * What is deliberately not here: prose. No test can tell whether "the interval is not lowered" is
 * still the decision, and pretending otherwise would be worse than leaving it to a human.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** The documents that describe the project, as opposed to its history. */
const DOCS = ['README.md', 'README.ru.md', 'ARCHITECTURE.md', 'DECISIONS.md', 'CONTRIBUTING.md',
  'AGENTS.md', 'SECURITY.md', 'PRIVACY.md', 'MENTIONS.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md', 'RELEASING.md'].filter((f) => fs.existsSync(path.join(ROOT, f)));

test('the documents agree with package.json about whether there is a linter', () => {
  // The claim flipped on 2026-09-10 and three files went on saying the old thing.
  const hasLinter = Boolean((pkg.devDependencies || {}).eslint);
  const denials = [];
  for (const doc of DOCS) {
    const text = read(doc);
    // "there is no linter", "no linter on purpose", and the Russian equivalent
    if (/there is no linter|no linter on purpose|линтера нет/i.test(text) === hasLinter) {
      // a historical mention is fine; a present-tense claim is not
      const line = text.split('\n').find((l) => /there is no linter|no linter on purpose|линтера нет/i.test(l));
      if (line && !/until |before |used to |было|раньше/i.test(line)) denials.push(`${doc}: ${line.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(denials, [], denials.join('; '));
  if (hasLinter) {
    assert.ok(fs.existsSync(path.join(ROOT, 'eslint.config.js')), 'eslint is a dependency with no config');
    assert.ok(pkg.scripts && pkg.scripts.lint, 'eslint is a dependency with no script to run it');
  }
});

test('every npm script the documents tell you to run exists', () => {
  const scripts = new Set(Object.keys(pkg.scripts || {}));
  const missing = [];
  for (const doc of DOCS.concat(['.github/workflows/test.yml', '.github/workflows/release.yml'])) {
    if (!fs.existsSync(path.join(ROOT, doc))) continue;
    for (const m of read(doc).matchAll(/npm run ([a-z][\w:-]*)/g)) {
      if (!scripts.has(m[1])) missing.push(`${doc} says "npm run ${m[1]}", which package.json does not have`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], missing.join('; '));
});

test('every workflow the documents point at is a workflow that exists', () => {
  const missing = [];
  for (const doc of DOCS) {
    const text = read(doc);
    for (const m of text.matchAll(/\.github\/workflows\/([\w.-]+\.yml)/g)) {
      // inside a URL it belongs to another repository - the catalog has workflows of its own,
      // and this file points at one of them on purpose
      if (/https?:\/\/[^\s)]*$/.test(text.slice(Math.max(0, m.index - 120), m.index))) continue;
      if (!fs.existsSync(path.join(ROOT, '.github', 'workflows', m[1]))) {
        missing.push(`${doc} points at .github/workflows/${m[1]}, which is not there`);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [], missing.join('; '));
});

test('every file a document names in backticks is a file that is there', () => {
  /* Only paths that look like this repository's own: something under a known top directory. A
     glob stands for at least one match. Commands, URLs and prose in backticks are left alone -
     the point is to catch a rename, not to parse English. */
  const OURS = /^(src|renderer|tools|test|config|assets|site|docs|\.github|\.claude)\//;
  const missing = [];
  for (const doc of DOCS.concat(['ARCHITECTURE.md'])) {
    for (const m of read(doc).matchAll(/`([^`\n]+)`/g)) {
      const claim = m[1].trim();
      if (/\s/.test(claim)) continue;                       // a command, not a path
      /* Only paths, never bare names. `settings.json` in these documents is the file in the
         user's data folder and `mods.json` is the catalog's, neither of which is here; a
         bare-name rule flagged eleven of those and nothing real. */
      if (!OURS.test(claim)) continue;
      if (claim.includes('*')) {
        // a glob: at least one file has to match it
        const dir = path.join(ROOT, path.dirname(claim));
        const pattern = new RegExp(`^${path.basename(claim).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
        const hit = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => pattern.test(f));
        if (!hit) missing.push(`${doc} names ${claim}, which matches nothing`);
        continue;
      }
      if (!fs.existsSync(path.join(ROOT, claim))) missing.push(`${doc} names ${claim}, which is not there`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], [...new Set(missing)].join('; '));
});

test('there are more test files than ARCHITECTURE.md says there are at least', () => {
  /* It said 45 on 2026-09-15, when there were 58: nobody rereads a count to check it. An exact
     count was tried next, and every pull request that added a test file changed the number, so
     two open at once conflicted on that line and the second failed in the merge queue on a count
     the first had moved. A floor, as DECISIONS.md already has: raise it now and then. */
  const m = read('ARCHITECTURE.md').match(/no framework, more than (\d+) files/);
  assert.ok(m, 'ARCHITECTURE.md no longer says how many test files there are');
  const real = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => /\.test\.(js|ts)$/.test(f)).length;
  assert.ok(real > Number(m[1]), `ARCHITECTURE.md says more than ${m[1]} test files and test/ has ${real}`);
});

test('every relative link in a document points at something that exists', () => {
  const missing = [];
  for (const doc of DOCS) {
    for (const m of read(doc).matchAll(/\]\(([^)]+)\)/g)) {
      const target = m[1].split('#')[0].trim();
      if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
      if (!fs.existsSync(path.join(ROOT, target))) missing.push(`${doc} links to ${target}, which is not there`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], [...new Set(missing)].join('; '));
});

test('the version DECISIONS.md was last read at is a version that was released', () => {
  /* The date itself is not asserted: it records when a person read the file, and a test that
     kept it current would be forging a review nobody did (see the note in the file). What can be
     checked is that the version beside it is real and not ahead of this one. */
  const doc = read('DECISIONS.md');
  const m = doc.match(/Last gone over on (\d{4}-\d{2}-\d{2}), at version ([\d.]+)\./);
  assert.ok(m, 'DECISIONS.md no longer says when it was last read');

  const [, when, version] = m;
  assert.ok(new Date(when) <= new Date(), `DECISIONS.md says it was read on ${when}, which has not happened yet`);

  const parts = (v) => v.split('.').map(Number);
  const [a, b, c] = parts(version);
  const [x, y, z] = parts(pkg.version);
  const ahead = a > x || (a === x && (b > y || (b === y && c > z)));
  assert.ok(!ahead, `DECISIONS.md says it was read at ${version}; this is ${pkg.version}`);
});

test('the Electron version the documents name is the one package.json installs', () => {
  /* Dependabot moves Electron a major version with one merge, and three documents say which one
     the app runs on. Nothing in that merge touches them, so they would go on naming the old
     version until somebody happened to read the line. */
  const major = String((pkg.devDependencies || {}).electron || '').match(/\d+/);
  assert.ok(major, 'package.json no longer names an Electron version');
  const wrong = [];
  for (const doc of DOCS.concat(['site/src/i18n/facts.ts', 'site/src/pages/llms.txt.ts'])) {
    if (!fs.existsSync(path.join(ROOT, doc))) continue;
    for (const m of read(doc).matchAll(/\bElectron (\d+)\b/g)) {
      if (m[1] !== major[0]) wrong.push(`${doc} says Electron ${m[1]}; package.json installs ${major[0]}`);
    }
  }
  assert.deepEqual([...new Set(wrong)], [], [...new Set(wrong)].join('; '));
});

test('the people who can merge are the same list in both places', () => {
  /* Rights and the record of them drift apart in the direction that matters: somebody is added on
     GitHub and the page saying who can merge still names one person. CODEOWNERS is what GitHub
     acts on, GOVERNANCE.md is what a reader is told, and neither is allowed to be alone. */
  const owners = new Set([...read('.github/CODEOWNERS').matchAll(/@([A-Za-z0-9-]+)/g)].map((m) => m[1]));
  const table = read('GOVERNANCE.md').split('## Who can merge')[1] || '';
  const named = new Set([...table.split('## Continuity')[0].matchAll(/\[@([A-Za-z0-9-]+)\]/g)].map((m) => m[1]));

  assert.ok(owners.size > 0, '.github/CODEOWNERS names nobody');
  assert.deepEqual([...owners].filter((h) => !named.has(h)), [],
    'in CODEOWNERS and not in the GOVERNANCE.md table');
  assert.deepEqual([...named].filter((h) => !owners.has(h)), [],
    'in the GOVERNANCE.md table and not in CODEOWNERS');
});


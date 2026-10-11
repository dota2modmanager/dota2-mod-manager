// docs/evidence.md, held to the repository it points into.
//
// That page exists for a reviewer who checks rather than reads: every row names a file, a
// command or a CI job. A row that points at a file that moved, a script that was renamed or a
// workflow that no longer exists is the row they try first, and after that they stop trusting the
// rest. So what can be looked up is looked up here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(root, 'docs', 'evidence.md'), 'utf-8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

test('every file and folder it names in backticks is in the repository', () => {
  const named = [...doc.matchAll(/`([^`\s]+)`/g)].map((m) => m[1])
    .filter((p) => /^(test|tools|src|docs|\.github|renderer)\//.test(p) || /^[\w.-]+\.(md|json|js|ts|mjs)$/.test(p))
    .filter((p) => !/^dota2-mod-manager\.cdx\.json$|^SHA256SUMS/.test(p)); // release assets, not files here
  assert.ok(named.length >= 15, `found only ${named.length} paths, so the pattern has stopped matching`);
  const missing = named.filter((p) => !fs.existsSync(path.join(root, p.replace(/\/$/, ''))));
  assert.deepEqual(missing, []);
});

test('every link it gives to another page in the repository resolves', () => {
  const links = [...doc.matchAll(/\]\(([^)#]+)(#[^)]*)?\)/g)].map((m) => m[1]).filter((l) => !/^https?:/.test(l));
  const missing = links.filter((l) => !fs.existsSync(path.join(root, 'docs', l)));
  assert.deepEqual(missing, []);
});

test('every npm script it tells you to run exists', () => {
  const scripts = [...doc.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 5);
  assert.deepEqual(scripts.filter((s) => !pkg.scripts[s]), []);
});

test('the workflows it names by their GitHub name are workflows here', () => {
  const names = new Set(fs.readdirSync(path.join(root, '.github', 'workflows'))
    .map((f) => /^name:\s*(.+)$/m.exec(fs.readFileSync(path.join(root, '.github', 'workflows', f), 'utf-8'))?.[1].trim()));
  for (const n of ['Tests', 'Mutants', 'Window', 'Simulation', 'Update', 'CodeQL', 'Scorecard', 'Dota updates']) {
    assert.ok(names.has(n), `no workflow is named ${n}`);
    assert.ok(doc.includes(n), `${n} is listed here but the page no longer mentions it`);
  }
});

test('the required checks it quotes are the required checks', () => {
  const required = JSON.parse(fs.readFileSync(path.join(root, '.github', 'required-checks.json'), 'utf-8')).branch;
  for (const q of ['Install a mod through the window', 'Analyse JavaScript and TypeScript', 'A fix brings its test']) {
    assert.ok(doc.includes(q), `the page no longer quotes "${q}"`);
    assert.ok(required.includes(q), `"${q}" is quoted as a check but is not in required-checks.json`);
  }
});

test('the number of deliberate breakages it gives is the number in .github/mutants.json', () => {
  const said = Number(/(\d+) deliberate breakages/.exec(doc)?.[1]);
  const have = JSON.parse(fs.readFileSync(path.join(root, '.github', 'mutants.json'), 'utf-8')).mutants.length;
  assert.equal(said, have, `the page says ${said}; .github/mutants.json has ${have}`);
});

test('the test count it gives is not more than there are test files to hold them', () => {
  const files = fs.readdirSync(path.join(root, 'test')).filter((f) => /\.test\.(js|ts)$/.test(f)).length;
  const said = Number(/in (\d+) files/.exec(doc)?.[1]);
  assert.ok(said > 0 && said <= files, `the page says ${said} files; test/ has ${files}`);
});

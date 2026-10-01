/* The sentences in the READMEs that are generated from the repository.
 *
 * "`package.json` lists exactly four" stayed in both READMEs for five days after eslint became the
 * fifth dependency. The sentence is now written by tools/gen-doc-facts.js, and this fails the moment
 * the README and the repository disagree.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { render, apply, bundledPackages, FILES } = require('../tools/gen-doc-facts.js');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('every facts block in the READMEs says what the repository says', () => {
  const facts = render(pkg);
  for (const rel of FILES) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(apply(text, facts), text, `${rel} is out of date: run node tools/gen-doc-facts.js`);
  }
});

test('the dependency sentence is a generated block in both languages', () => {
  const en = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const ru = fs.readFileSync(path.join(ROOT, 'README.ru.md'), 'utf8');
  assert.match(en, /<!-- facts:deps-en -->/);
  assert.match(ru, /<!-- facts:deps-ru -->/);
  assert.doesNotMatch(en, /exactly four/, 'the typed sentence is back');
  assert.doesNotMatch(ru, /ровно четыре/, 'the typed sentence is back');
});

test('the sentence follows package.json, not the other way round', () => {
  const five = render({ dependencies: { 'adm-zip': '1', 'electron-updater': '1' }, devDependencies: { electron: '1', 'electron-builder': '1', eslint: '1' } });
  assert.equal(five['deps-en'], '`package.json` lists five: `adm-zip` and `electron-updater` ship inside the app, `electron`, `electron-builder` and `eslint` only build or check it.');
  const four = render({ dependencies: { 'adm-zip': '1', 'electron-updater': '1' }, devDependencies: { electron: '1', 'electron-builder': '1' } });
  assert.match(four['deps-en'], /lists four/);
  assert.match(four['deps-ru'], /их четыре/);
});

test('a README checked out on Windows is still read, not skipped', () => {
  /* On a Windows checkout every newline is CRLF. The block pattern was written against \n, so it
     matched nothing there, apply() returned the file unchanged, and --check reported every block
     current however stale it was. The Windows CI job is where that would have hidden. */
  const facts = render(pkg);
  const stale = '# x\r\n<!-- facts:deps-en -->\r\nold words\r\n<!-- /facts:deps-en -->\r\nmore\r\n';
  const out = apply(stale, facts);
  assert.notEqual(out, stale, 'a CRLF block was not recognised');
  assert.ok(out.includes(`<!-- facts:deps-en -->\r\n${facts['deps-en']}\r\n<!-- /facts:deps-en -->`), 'the block was not rewritten with the file\'s own line endings');
  const current = apply(out, facts);
  assert.equal(apply(current, facts), current, 'rewriting a current block changed it again');
});

test('a package the window imports is named as part of the app, not as a build tool', () => {
  /* react and motion are devDependencies because Vite bundles them into out/renderer, so the
     installer carries their code without the packages. Sorting by package.json alone called them
     build tools, which is the one thing a reader checking what runs on their machine must not
     be told. */
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mm-facts-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'views', 'a.tsx'), "import { motion } from 'motion/react';\nimport x from './local.js';\n");
  fs.writeFileSync(path.join(dir, 'b.js'), "import '@scope/pkg/sub';\nimport { createRoot } from 'react-dom/client';\n");
  assert.deepEqual(bundledPackages(dir).sort(), ['@scope/pkg', 'motion', 'react-dom']);
  fs.rmSync(dir, { recursive: true, force: true });

  const facts = render({ dependencies: { 'adm-zip': '1' }, devDependencies: { react: '1', vite: '1' } }, ['react']);
  assert.equal(facts['deps-en'], '`package.json` lists three: `adm-zip` ship inside the app, `react` are built into its window, `vite` only build or check it.');
  assert.match(facts['deps-ru'], /`react` собраны в его окно, `vite` только собирают/);
});

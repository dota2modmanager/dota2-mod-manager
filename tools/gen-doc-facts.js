#!/usr/bin/env node
/**
 * The facts in the READMEs that the repository already knows, written from the repository.
 *
 * README.md said "`package.json` lists exactly four" for five days after eslint became the fifth,
 * and README.ru.md said the same in Russian. Nobody lied; a number was typed once and the file it
 * described moved on. A test that checks the sentence still has to be updated by hand, so the
 * sentence is generated instead: anything between `<!-- facts:NAME -->` and `<!-- /facts:NAME -->`
 * is written by this script, and test/doc-facts.test.js fails when a README holds anything else
 * there.
 *
 * Usage:
 *   node tools/gen-doc-facts.js            # rewrite the blocks
 *   node tools/gen-doc-facts.js --check    # exit 1 if any block is out of date
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['README.md', 'README.ru.md'];

const EN = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const RU = ['ни одной', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать'];

const code = (name) => `\`${name}\``;
const list = (items, and) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`);

/**
 * The packages the window's own code imports. They are devDependencies, because Vite bundles
 * them into out/renderer and the installer has no use for the packages themselves, but their
 * code runs in the app all the same, and a sentence calling them build tools would be false.
 */
function bundledPackages(dir = path.join(ROOT, 'renderer')) {
  const found = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js|jsx|tsx?)$/.test(e.name)) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/(?:from|import)\s*['"]([^'"./][^'"]*)['"]/g)) {
          const parts = m[1].split('/');
          found.add(m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
        }
      }
    }
  };
  walk(dir);
  return [...found];
}

/** Every generated sentence, by block name. */
function render(pkg, bundled = bundledPackages()) {
  const dev = Object.keys(pkg.devDependencies || {}).sort();
  const ship = Object.keys(pkg.dependencies || {}).sort().map(code);
  const window = dev.filter((n) => bundled.includes(n)).map(code);
  const build = dev.filter((n) => !bundled.includes(n)).map(code);
  const total = ship.length + window.length + build.length;
  const inWindowEn = window.length ? ` ${list(window, 'and')} are built into its window,` : '';
  const inWindowRu = window.length ? ` ${list(window, 'и')} собраны в его окно,` : '';
  return {
    'deps-en': `\`package.json\` lists ${EN[total] || total}: ${list(ship, 'and')} ship inside the app,${inWindowEn} ${list(build, 'and')} only build or check it.`,
    'deps-ru': `В \`package.json\` их ${RU[total] || total}: ${list(ship, 'и')} едут внутри приложения,${inWindowRu} ${list(build, 'и')} только собирают или проверяют его.`,
  };
}

/**
 * The text with every known block replaced by what it should say. Unknown blocks are left alone.
 *
 * A Windows checkout has CRLF line endings. The pattern used to expect a bare newline, matched
 * nothing there, and --check reported every block current however stale it was, so the file's
 * own line ending is kept and matched.
 */
function apply(text, facts) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  return text.replace(/<!-- facts:([a-z0-9-]+) -->\r?\n[\s\S]*?\r?\n<!-- \/facts:\1 -->/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(facts, name) ? `<!-- facts:${name} -->${nl}${facts[name]}${nl}<!-- /facts:${name} -->` : whole
  ));
}

module.exports = { render, apply, bundledPackages, FILES };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const facts = render(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')));
  let stale = 0;
  for (const rel of FILES) {
    const file = path.join(ROOT, rel);
    const text = fs.readFileSync(file, 'utf8');
    const next = apply(text, facts);
    if (next === text) continue;
    stale++;
    if (check) console.error(`${rel}: a facts block is out of date, run node tools/gen-doc-facts.js`);
    else fs.writeFileSync(file, next);
  }
  if (check && stale) process.exit(1);
  console.log(check ? 'facts blocks are current' : `facts blocks written (${stale} file${stale === 1 ? '' : 's'} changed)`);
}

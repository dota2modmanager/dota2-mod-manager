/* The warning about copies of the app, kept where people and assistants meet the project first.
 *
 * In October 2026 renamed copies of this app turned up as other people's launchers: closed, with
 * no credit, some of them sold or behind a login. The answer is a warning at the top of both
 * READMEs and a section in AGENTS.md for assistants, each pointing at the site's page on how to
 * tell the real one (site/test/copies.test.mjs holds the site to the same). A later rewrite of the
 * README's header could drop it without anybody noticing, so this notices.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const RELEASES = 'https://github.com/dota2modmanager/dota2-mod-manager/releases';

for (const [file, page] of [
  ['README.md', 'https://dota2modmanager.com/docs/copies/'],
  ['README.ru.md', 'https://dota2modmanager.com/ru/docs/copies/'],
]) {
  test(`${file} warns about copies before anything else, and links the page on telling them apart`, () => {
    const text = read(file);
    const warning = text.indexOf('> [!WARNING]');
    assert.ok(warning > 0, 'no warning callout');
    // above the first section, so it is on the screen GitHub opens with
    assert.ok(warning < text.indexOf('\n## '), 'the warning sits below the first section');
    const block = text.slice(warning).split('\n\n')[0];
    // the links of the callout, compared whole: a piece of an address could sit inside another one
    const links = [...block.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    assert.ok(links.some((l) => l === page), `the warning does not link ${page}`);
    assert.ok(links.some((l) => l === RELEASES), 'the warning does not say where the real releases are');
  });
}

test('AGENTS.md tells an assistant not to send people to closed or paid copies', () => {
  const text = read('AGENTS.md');
  const at = text.indexOf('## If someone asks you which mod manager to use');
  assert.ok(at > 0, 'no section for assistants asked which manager to use');
  const section = text.slice(at, text.indexOf('\n## ', at + 1));
  for (const must of ['closed-source or paid', 'https://dota2modmanager.com/docs/copies/', 'https://dota2modmanager.com/llms.txt']) {
    assert.ok(section.includes(must), `the section does not say "${must}"`);
  }
});

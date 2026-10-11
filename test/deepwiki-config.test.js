// .devin/wiki.json, the notes and page plan DeepWiki writes its wiki from, held to DeepWiki's
// limits and to the repository.
//
// DeepWiki reads the file the next time the wiki is regenerated and drops what it cannot take: a
// thirty-first page, a note over its length, a page whose parent is not a page. A note that names
// a file the repository no longer has is worse, because the wiki repeats it as fact. Both kinds of
// drift are caught here rather than on a wiki page somebody reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const wiki = JSON.parse(fs.readFileSync(path.join(root, '.devin', 'wiki.json'), 'utf-8'));

test('the plan fits what DeepWiki takes: 30 pages, 100 notes, 10,000 characters a note', () => {
  assert.ok(wiki.pages.length >= 1 && wiki.pages.length <= 30, `${wiki.pages.length} pages`);
  const notes = [...wiki.repo_notes, ...wiki.pages.flatMap((p) => p.page_notes || [])];
  assert.ok(notes.length <= 100, `${notes.length} notes`);
  for (const n of notes) assert.ok(n.content && n.content.length <= 10000, `a note of ${n.content?.length} characters`);
});

test('every page has a title of its own, a purpose, and a parent that is a page', () => {
  const titles = wiki.pages.map((p) => p.title);
  assert.equal(new Set(titles).size, titles.length, 'two pages share a title');
  for (const p of wiki.pages) {
    assert.ok(p.title.trim() && p.purpose.trim(), JSON.stringify(p));
    if (p.parent) assert.ok(titles.includes(p.parent), `${p.title}: no page is called ${p.parent}`);
  }
});

test('every file the notes and pages name is in the repository', () => {
  const text = JSON.stringify(wiki);
  const named = [...text.matchAll(/\b((?:src|test|docs|renderer|tools|\.github\/workflows)\/[\w./-]+\.(?:ts|js|mjs|md|yml|json))\b/g)].map((m) => m[1]);
  assert.ok(named.length >= 10, `found only ${named.length} paths, so the pattern has stopped matching`);
  assert.deepEqual([...new Set(named)].filter((p) => !fs.existsSync(path.join(root, p))), []);
});

test('the npm scripts the notes name exist', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).scripts;
  const named = [...JSON.stringify(wiki).matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  assert.deepEqual(named.filter((s) => !scripts[s]), []);
});

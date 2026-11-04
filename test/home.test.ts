/* Home's rules (renderer/home/model.ts): one line per change of a version, the newest news first,
 * and counts the way people read them. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { latestNews, notePoints, shortCount } from '../renderer/home/model.ts';

test('a version is listed by its ### headings, links and emphasis taken out, five at most', () => {
  const section = [
    '### Mods by author, and a catalog that **remembers**', '', 'Body text.', '',
    '### Your look on [everyone](https://x)', '### A', '### B', '### C', '### D',
  ].join('\n');
  assert.deepEqual(notePoints(section), ['Mods by author, and a catalog that remembers', 'Your look on everyone', 'A', 'B', 'C']);
});

test('a section written as a plain list gives its items, and nothing gives nothing', () => {
  assert.deepEqual(notePoints('- one\n- `two`\r\n* three'), ['one', 'two', 'three']);
  assert.deepEqual(notePoints(null), []);
  assert.deepEqual(notePoints('just a paragraph'), []);
});

test('news comes newest first, undated last, three at most', () => {
  const n = latestNews([
    { id: 'a', text: 'a', date: '2026-10-01' }, { id: 'b', text: 'b' },
    { id: 'c', text: 'c', date: '2026-11-02' }, { id: 'd', text: 'd', date: '2026-10-20' },
  ]);
  assert.deepEqual(n.map((x) => x.id), ['c', 'd', 'a']);
  assert.deepEqual(latestNews(undefined), []);
});

test('counts read as people read them', () => {
  assert.equal(shortCount(7), '7');
  assert.equal(shortCount(1806), '1 806');
  assert.equal(shortCount(12345), '12.3k');
  assert.equal(shortCount(150000), '150k');
});

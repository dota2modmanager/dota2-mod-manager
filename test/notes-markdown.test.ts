/* The "What's new" window's reading of a changelog section (renderer/ui/notes-markdown.ts).
 *
 * The 2.8.0 window showed the item builder's two paragraphs as one: a blank line ended a list but
 * not a paragraph, so the second ran on into the first. These hold the shapes the changelogs use,
 * and the real 2.8.0 section in both languages.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { notesHtml } from '../renderer/ui/notes-markdown.ts';

test('a blank line ends a paragraph, and a wrapped line continues it', () => {
  assert.equal(notesHtml('First line\nwrapped on.\n\nSecond paragraph.'), '<p>First line wrapped on.</p><p>Second paragraph.</p>');
});

test('headings, bullets with wrapped lines, bold and code come out as they are written', () => {
  const html = notesHtml('### Fixes\n\n- One fix\n  that wraps.\n- **Two** and `code`.\n\nAfter the list.');
  assert.equal(html, '<h4>Fixes</h4><ul><li>One fix that wraps.</li><li><b>Two</b> and <code>code</code>.</li></ul><p>After the list.</p>');
});

test('a paragraph straight after a heading or a list starts a new one', () => {
  assert.equal(notesHtml('Intro.\n### Heading\nText.'), '<p>Intro.</p><h4>Heading</h4><p>Text.</p>');
  assert.equal(notesHtml('- item\n\nText.'), '<ul><li>item</li></ul><p>Text.</p>');
});

test('text from the changelog is escaped, never markup', () => {
  assert.equal(notesHtml('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
});

test('the 2.8.0 section shows each of its paragraphs as one, in both languages', () => {
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ru.md']) {
    const text = fs.readFileSync(path.join(import.meta.dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
    const section = text.split('\n## 2.8.0\n')[1].split('\n## ')[0];
    const paragraphs = section.split(/\n\s*\n/).filter((b) => b.trim() && !/^\s*(###|- )/.test(b));
    const html = notesHtml(section);
    assert.equal((html.match(/<p>/g) || []).length, paragraphs.length, `${file}: every paragraph of 2.8.0 is its own`);
  }
});

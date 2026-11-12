/* The "What's new" text (src/release-notes.ts): the right section, in the right language, and
 * nothing when there is nothing to say. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { changelogSection, changelogVersions, notesRange, releaseNotes } from '../src/release-notes.ts';

function build(t: TestContext, files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-notes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

const EN = '# Changelog\n\n## 2.8.0\n\n- Packs open smoothly\n\n## 2.8.0-beta.1\n\n- The beta\n\n## 2.7.1 (2026-09-20)\n\n- A fix\n';
const RU = '# Изменения\n\n## 2.8.0\n\n- Паки открываются плавно\n';

test('a Russian interface gets the Russian section', (t) => {
  assert.equal(releaseNotes('2.8.0', 'ru', build(t, { 'CHANGELOG.md': EN, 'CHANGELOG.ru.md': RU })), '- Паки открываются плавно');
});

test('a version the Russian file never got falls back to English, not to nothing', (t) => {
  assert.equal(releaseNotes('2.7.1', 'ru', build(t, { 'CHANGELOG.md': EN, 'CHANGELOG.ru.md': RU })), '- A fix');
});

test('an English interface never reads the Russian file', (t) => {
  assert.equal(releaseNotes('2.8.0', 'en', build(t, { 'CHANGELOG.md': EN, 'CHANGELOG.ru.md': RU })), '- Packs open smoothly');
});

test('a release is not its beta, and a heading may carry a date', () => {
  assert.equal(changelogSection(EN, '2.8.0'), '- Packs open smoothly');
  assert.equal(changelogSection(EN, '2.8.0-beta.1'), '- The beta');
  assert.equal(changelogSection(EN, '2.7.1'), '- A fix');
  assert.equal(changelogSection(EN, '2.8'), null, 'a prefix of a version is not that version');
  // a beta section left above its release: the release's own heading is found, not the first
  // one that starts with the same digits
  const betaFirst = '## 2.8.0-beta.1\n\n- The beta\n\n## 2.8.0\n\n- The release\n';
  assert.equal(changelogSection(betaFirst, '2.8.0'), '- The release');
});

test('no section, an empty section and no file all answer null', (t) => {
  assert.equal(releaseNotes('9.9.9', 'en', build(t, { 'CHANGELOG.md': EN })), null);
  assert.equal(releaseNotes('3.0.0', 'en', build(t, { 'CHANGELOG.md': '## 3.0.0\n\n## 2.9.0\n\n- x\n' })), null);
  assert.equal(releaseNotes('2.8.0', 'en', build(t, {})), null);
});

const LINE = '# Changelog\n\n## 3.0.1\n\n- The fix\n\n## 3.0.0\n\n### The big one\n\n- Everything\n\n## 2.21.0\n\n- Before\n\n## 2.20.0\n\n- Long ago\n';

test('a fix right after a big release keeps that release beside it, newest first', (t) => {
  // nobody had read 3.0.0 yet when 3.0.1 came an hour later: its notes must not vanish
  const notes = releaseNotes('3.0.1', 'en', build(t, { 'CHANGELOG.md': LINE }), '3.0.0');
  assert.equal(notes, '## 3.0.1\n\n- The fix\n\n## 3.0.0\n\n### The big one\n\n- Everything');
});

test('the notes reach back to the version last seen, and no further than this line without one', () => {
  const all = ['3.0.1', '3.0.0', '2.21.0', '2.20.0'];
  assert.deepEqual(notesRange(all, '3.0.1', '2.21.0'), ['3.0.1', '3.0.0']);
  assert.deepEqual(notesRange(all, '3.0.1', '2.20.0'), ['3.0.1', '3.0.0', '2.21.0'], 'skipped versions are shown');
  assert.deepEqual(notesRange(all, '3.0.1', null), ['3.0.1', '3.0.0']);
  assert.deepEqual(notesRange(['3.1.2', '3.1.1', '3.1.0', '3.0.0'], '3.1.2', '3.1.1'), ['3.1.2', '3.1.1', '3.1.0'], 'the line starts at x.y.0');
  assert.deepEqual(notesRange(all, '3.0.0', '2.21.0'), ['3.0.0'], 'a release alone is just its own section');
  assert.deepEqual(changelogVersions('## 3.1.0-beta.1\n\n## 3.0.0 (2026-11-04)\n'), ['3.0.0'], 'betas are not part of a line');
});

test('the What\'s new window gives each version a heading of its own', async () => {
  const { notesHtml } = await import('../renderer/ui/notes-markdown.ts');
  assert.match(notesHtml('## 3.0.1\n\n- Fix\n\n## 3.0.0\n\n### Big'), /<h3 class="notes-version">3\.0\.1<\/h3><ul><li>Fix<\/li><\/ul><h3 class="notes-version">3\.0\.0<\/h3><h4>Big<\/h4>/);
});

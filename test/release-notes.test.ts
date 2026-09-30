/* The "What's new" text (src/release-notes.ts): the right section, in the right language, and
 * nothing when there is nothing to say. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { changelogSection, releaseNotes } from '../src/release-notes.ts';

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

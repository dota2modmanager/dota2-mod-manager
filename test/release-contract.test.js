/* The release, checked as a contract rather than remembered as a routine.
 *
 * A release here is five things that have to agree: the version in package.json, a section
 * under that number in the English changelog, the same section in the Russian one, the tag CI
 * builds from, and the notes CI lifts out of the changelog to put on the release page and into
 * the Discord post. Nothing enforced any of it.
 *
 * It has gone wrong twice. A `## 1.13.1` section was written for a fix that was never tagged
 * and had to be folded into the next version by hand. And `## 1.13.0` sat in the English
 * changelog complete while the Russian one was missing a feature and the whole Fixed block -
 * which nobody saw, because the only reader of the Russian file is a Russian user's "what's
 * new" popup.
 *
 * These run on every push. They cannot check that the words are good; they can check that a
 * version exists in both languages, that the two files agree about which versions exist, and
 * that CI will find something to publish.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const version = () => JSON.parse(read('package.json')).version;
// a release is 2.8.0, a beta 2.8.0-beta.1: the one suffix release.yml knows (its `*-beta.*`)
const VERSION = String.raw`\d+\.\d+\.\d+(?:-beta\.\d+)?`;
// every metacharacter, not just the dot: a version is only digits and dots today, and a
// pre-release tag with a "+" in it would otherwise stop matching its own heading
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sections = (rel) => [...read(rel).matchAll(new RegExp(`^## (${VERSION})\\s*$`, 'gm'))].map((m) => m[1]);

test('the version in package.json has a section in both changelogs', () => {
  /* Both, not either. releaseNotes() in main.js serves CHANGELOG.ru.md to a Russian UI and
   * falls back to the English one, so a missing Russian section is invisible to anybody
   * developing in English and is the only thing a Russian user sees. */
  const v = version();
  assert.ok(sections('CHANGELOG.md').includes(v), `CHANGELOG.md has no "## ${v}"`);
  assert.ok(sections('CHANGELOG.ru.md').includes(v), `CHANGELOG.ru.md has no "## ${v}"`);
});

test('the two changelogs describe the same set of versions, in the same order', () => {
  assert.deepEqual(sections('CHANGELOG.ru.md'), sections('CHANGELOG.md'),
    'one file has a version the other does not, or they disagree about the order');
});

test('the newest section is the version being shipped', () => {
  /* Newest first is the order both files are written in and the order the popup assumes. A
   * section added above the current version means somebody wrote notes for a release that has
   * not happened, which is exactly how 1.13.1 came to exist and never ship. */
  assert.equal(sections('CHANGELOG.md')[0], version());
});

test('a version appears once, not twice', () => {
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ru.md']) {
    const seen = sections(file);
    const dupes = seen.filter((v, i) => seen.indexOf(v) !== i);
    assert.deepEqual([...new Set(dupes)], [], `${file} repeats ${[...new Set(dupes)].join(', ')}`);
  }
});

test('a section has something in it', () => {
  /* An empty section is worse than a missing one: CI finds it, publishes nothing, and the
   * release page looks like the release did nothing. */
  const v = version();
  const heading = escapeRe(v);
  for (const file of ['CHANGELOG.md', 'CHANGELOG.ru.md']) {
    const body = read(file).split(new RegExp(`^## ${heading}\\s*$`, 'm'))[1] || '';
    const untilNext = body.split(new RegExp(`^## ${VERSION}\\s*$`, 'm'))[0].trim();
    assert.ok(untilNext.length > 80, `${file}: the ${v} section is ${untilNext.length} characters`);
  }
});

test('the version is one CI can turn into a tag', () => {
  // release.yml triggers on v*, calls a tag with "-beta." in it a beta, and reads the section
  // named by the tag without the v. Any other suffix would be built and published as a release.
  assert.match(version(), new RegExp(`^${VERSION}$`), 'only -beta.N is a suffix release.yml knows');
});

test('the lookups that read a section find a beta by its own heading', () => {
  /* release.yml's awk and releaseNotes() in main.js both look for "## <version>" followed by
   * anything that cannot continue a version. Until 2026-09-26 that was "anything but a digit or a
   * dot", so "## 2.8.0" also matched the heading "## 2.8.0-beta.1", and the right section came first
   * only while the newest was on top: a beta section left above the release would have gone out as
   * the release's notes, on its page, in Discord and in the "What's new" window. Both are copied
   * here and run against a changelog with the release above its beta, and with the beta above. */
  const texts = [
    '## 2.8.0\n\nthe release\n\n## 2.8.0-beta.1\n\nthe beta\n\n## 2.7.1\n\nthe one before\n',
    '## 2.8.0-beta.1\n\nthe beta\n\n## 2.8.0\n\nthe release\n\n## 2.7.1\n\nthe one before\n',
  ];
  let text = texts[0];
  const awk = (v) => { // release.yml: $0 ~ "^## " v "([^-0-9A-Za-z.]|$)", then up to the next "## "
    const lines = text.split('\n');
    const at = lines.findIndex((l) => new RegExp(`^## ${v}([^-0-9A-Za-z.]|$)`).test(l));
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((l) => /^## /.test(l));
    return rest.slice(0, end === -1 ? undefined : end).join('\n').trim();
  };
  const popup = (v) => { // main.js releaseNotes; escaped whole here, where main.js escapes dots
    const m = new RegExp(`^## ${escapeRe(v)}(?:[^-0-9A-Za-z.].*)?$`, 'm').exec(text);
    const rest = text.slice(m.index + m[0].length);
    const next = /^## /m.exec(rest);
    return (next ? rest.slice(0, next.index) : rest).trim();
  };
  const { changelogSection } = require('../tools/release-state.js');
  const preflight = (v) => changelogSection(text, v); // what the gate checks before building
  for (text of texts) {
    for (const find of [awk, popup, preflight]) {
      assert.equal(find('2.8.0'), 'the release');
      assert.equal(find('2.8.0-beta.1'), 'the beta');
      assert.equal(find('2.7.1'), 'the one before');
    }
  }
  assert.match(read('.github/workflows/release.yml'), /\$0 ~ "\^## " v "\(\[\^-0-9A-Za-z\.\]\|\$\)"/,
    'release.yml looks a section up another way now: change the copy above');
  assert.match(read('main.js'), /\(\?:\[\^-0-9A-Za-z\.\]\.\*\)\?\$/, 'releaseNotes looks a section up another way now');
});

test('both changelogs still reach the two places that read them', () => {
  /* They travel by different roads, and only one of them is the workflow.
   *
   * CI lifts the tagged section out of CHANGELOG.md for the release page and the Discord post.
   * The Russian one never goes near CI: it is packaged into the build by package.json, and
   * releaseNotes() in main.js reads it off disk to fill the "what's new" popup for a Russian
   * UI. Drop it from the packaged files and Russian users get an empty popup while every check
   * above still passes - which is the shape of the incident this file is named after. */
  assert.match(read('.github/workflows/release.yml'), /CHANGELOG\.md/,
    'release.yml no longer reads CHANGELOG.md for the release page');

  const packaged = JSON.parse(read('package.json')).build.files;
  for (const f of ['CHANGELOG.md', 'CHANGELOG.ru.md']) {
    assert.ok(packaged.includes(f), `${f} is not packaged, so the app cannot show its notes`);
  }
  assert.match(read('main.js') + read('src/ipc-window.ts'), /CHANGELOG\.ru\.md/,
    'nothing reads the Russian changelog any more');
});

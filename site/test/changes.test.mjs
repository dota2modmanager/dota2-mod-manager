/**
 * What's new (/changes/), held to the two changelogs it is built from: the same released versions
 * in the same order on both language pages, each with its own notes, no beta, the newest marked,
 * and the changelog's markup turned into tags without letting a stray "<" become one. And the
 * ways there: the version badge on the landing and the footer.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, serveDist, launch, openPage, isOffline } from './harness.mjs';

const REPO = path.resolve(DIST, '..', '..');
const read = (p) => fs.readFileSync(path.join(DIST, p, 'index.html'), 'utf-8');

/** The plain-version sections of a changelog, newest first, with their first ### heading. */
function sections(file) {
  const text = fs.readFileSync(path.join(REPO, file), 'utf-8').replace(/\r\n/g, '\n');
  const parts = text.split(/^## (\S+)[ \t]*$/m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (!/^\d+\.\d+\.\d+$/.test(parts[i])) continue;
    out.push({ version: parts[i], heading: parts[i + 1].match(/^### (.+)$/m)?.[1] ?? null });
  }
  return out;
}

let server, browser;
before(async () => {
  server = await serveDist();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test('the page lists every released version of the changelog, newest first, in both languages', () => {
  for (const [lang, file] of [['en', 'CHANGELOG.md'], ['ru', 'CHANGELOG.ru.md']]) {
    const body = read(lang === 'ru' ? 'ru/changes' : 'changes');
    const shown = [...body.matchAll(/<h2 id="v[\d-]+-h">([^<]+)<\/h2>/g)].map((m) => m[1]);
    const all = sections(file);
    assert.ok(shown.length >= 10, `${lang}: ${shown.length} versions`);
    // what is shown is the changelog from the newest released version down, nothing skipped
    const from = all.findIndex((s) => s.version === shown[0]);
    assert.ok(from >= 0, `${lang}: ${shown[0]} is in ${file}`);
    assert.deepEqual(shown, all.slice(from).map((s) => s.version), `${lang}: the same versions in the same order`);
    assert.doesNotMatch(shown.join(' '), /beta/);
    // each version carries its own notes: the first heading of its section is on the page
    for (const s of all.slice(from).filter((x) => x.heading)) {
      const text = s.heading.replace(/\*\*|`/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      assert.ok(body.includes(text), `${lang} ${s.version}: "${s.heading}"`);
    }
    // the newest is marked, and every one has a date and its release on GitHub
    assert.equal((body.match(/class="release-latest"/g) ?? []).length, 1);
    assert.equal((body.match(/<time datetime="\d{4}-\d\d-\d\d"/g) ?? []).length, shown.length, `${lang}: a date for every version`);
    for (const v of shown) assert.ok(body.includes(`/releases/tag/v${v}"`), `${lang}: ${v} links to its release`);
  }
});

test('the changelog markup becomes tags, and a "<" in it stays text', async () => {
  const { context, page, problems } = await openPage(browser, server.url, 'desktop', { motion: 'reduce' });
  await page.goto(`${server.url}/changes/`, { waitUntil: 'load' });
  const text = await page.locator('.changes').textContent();
  // no markdown left over: a line that still starts as a heading or a bullet, or bold markers
  const lines = (await page.locator('.changes').innerText()).split('\n').map((l) => l.trim());
  assert.deepEqual(lines.filter((l) => /^(#{2,4} |- )/.test(l) || l.includes('**')), []);
  // CHANGELOG.md writes models/items/<hero> in code; it must read as written, not vanish as a tag
  if (fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf-8').includes('models/items/<hero>')) {
    assert.ok(text.includes('models/items/<hero>'));
    assert.equal(await page.locator('.changes hero').count(), 0);
  }
  assert.ok((await page.locator('.release-body code').count()) > 0);
  assert.ok((await page.locator('.release-body h3').count()) > 0);
  // a version's anchor lands on it
  const second = page.locator('.release').nth(1);
  const id = await second.getAttribute('id');
  await page.goto(`${server.url}/changes/#${id}`, { waitUntil: 'load' });
  const top = await second.evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(top >= 0 && top < 200, `#${id} is at ${Math.round(top)} px`);
  assert.deepEqual(problems.filter((l) => !isOffline(l)), []);
  await context.close();
});

test('older releases are folded to a row, and an address or the list of versions opens one', async () => {
  for (const screen of ['desktop', 'mobile']) {
    const { context, page } = await openPage(browser, server.url, screen, { motion: 'reduce' });
    await page.goto(`${server.url}/changes/`, { waitUntil: 'load' });
    const folds = page.locator('details.release-old');
    assert.ok((await folds.count()) >= 5, 'the older ones are folded');
    assert.equal(await page.locator('section.release').count(), 3, 'the newest three are open');
    // a folded row says what the release was about
    assert.ok((await folds.first().locator('.release-about').textContent()).length > 5);
    // an address naming a folded version opens it and shows it
    const id = await folds.nth(4).getAttribute('id');
    await page.goto(`${server.url}/changes/#${id}`, { waitUntil: 'load' });
    const opened = page.locator(`#${id}`);
    assert.equal(await opened.evaluate((d) => d.open), true);
    const top = await opened.evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(top >= 0 && top < 200, `${screen}: #${id} is at ${Math.round(top)} px`);
    if (screen === 'desktop') {
      // the list at the side does the same for another one
      const other = await folds.nth(8).getAttribute('id');
      await page.locator(`.release-toc a[href="#${other}"]`).click();
      await page.waitForFunction((x) => document.getElementById(x).open, other);
    }
    await context.close();
  }
});

test('the version badge and the footer lead to the page', () => {
  for (const lang of ['en', 'ru']) {
    const prefix = lang === 'ru' ? '/ru' : '';
    const landing = read(lang === 'ru' ? 'ru' : '');
    // the badge appears when the build could ask GitHub for the newest version
    const badge = landing.match(/<a class="badge" href="([^"]+)"/);
    if (badge) assert.equal(badge[1], `${prefix}/changes/`);
    assert.ok(read(lang === 'ru' ? 'ru/facts' : 'facts').includes(`<a href="${prefix}/changes/">`), `${lang}: the footer links it`);
  }
});

/**
 * The search in the header (src/scripts/site-search.ts): it opens from the button, from Ctrl+K
 * and from "/", and on a phone from the menu; it finds heroes by their Russian names and
 * nicknames, authors by name and mods the way the catalog does; the keyboard walks the answers
 * and Enter follows one; and the box fits a 320 px phone with its answers showing.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, serveDist, launch, openPage, findOverflow, isOffline, snap } from './harness.mjs';

const data = JSON.parse(fs.readFileSync(path.join(DIST, 'catalog', 'data.json'), 'utf-8'));
const topAuthor = (() => {
  const n = new Map();
  for (const m of data.mods) if (m[10]) n.set(m[10], [m[5], (n.get(m[10])?.[1] ?? 0) + 1]);
  return [...n].sort((a, b) => b[1][1] - a[1][1])[0];
})();

let server, browser;
before(async () => {
  server = await serveDist();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(path, screen = 'desktop') {
  const { context, page, problems } = await openPage(browser, server.url, screen, { motion: 'reduce' });
  await page.goto(server.url + path, { waitUntil: 'load' });
  return { context, page, problems };
}
const box = (page) => page.locator('#sitesearch');
/** Type a question and wait for the answers to it, not for the last question's still on show. */
const ask = async (page, q) => {
  await page.locator('#sitesearch-q').fill(q);
  await page.waitForFunction((x) => document.getElementById('sitesearch-list')?.dataset.q === x, q);
};

test('the header search finds heroes by nickname, authors by name and mods, and Enter follows one', async () => {
  const { context, page, problems } = await open('/facts/');
  await page.locator('.bar .search-btn').click();
  assert.equal(await box(page).evaluate((d) => d.open), true);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'sitesearch-q');

  // a nickname players use finds the hero
  await ask(page, 'кристалка');
  assert.equal(await page.locator('#sitesearch-list a[href="/heroes/crystal-maiden/"]').count(), 1);
  // the Russian name finds the hero first and his mods after
  await ask(page, 'пудж');
  const hrefs = await page.locator('#sitesearch-list .ss-row').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  assert.equal(hrefs[0], '/heroes/pudge/');
  assert.ok(hrefs.some((h) => h.startsWith('/mods/')), 'and mods for him');
  // an author by name
  await ask(page, topAuthor[1][0]);
  assert.equal(await page.locator(`#sitesearch-list a[href="/authors/${topAuthor[0]}/"]`).count(), 1);
  // many mods: the rest are a link to the catalog's own search
  await ask(page, 'arcana');
  assert.match(await page.locator('#sitesearch-list .ss-all').getAttribute('href'), /^\/catalog\/\?q=arcana$/);
  // nothing: says so
  await ask(page, 'qqqzzzxxx');
  assert.equal(await page.locator('#sitesearch-list .ss-empty').count(), 1);

  // the keyboard walks the answers and Enter follows the one it is on
  await ask(page, 'pudge');
  await page.keyboard.press('ArrowDown');
  const target = await page.locator('#sitesearch-list [aria-selected="true"]').getAttribute('href');
  assert.equal(await page.locator('#sitesearch-q').getAttribute('aria-activedescendant'), await page.locator('#sitesearch-list [aria-selected="true"]').getAttribute('id'));
  await page.keyboard.press('Enter');
  await page.waitForURL(`${server.url}${target}`);
  assert.deepEqual(problems.filter((l) => !isOffline(l)), []);
  await context.close();
});

test('Ctrl+K and "/" open it from any page, Escape closes it, and "/" in a text field types a slash', async () => {
  const { context, page } = await open('/heroes/');
  await page.keyboard.press('Control+k');
  assert.equal(await box(page).evaluate((d) => d.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await box(page).evaluate((d) => d.open), false);
  await page.keyboard.press('/');
  assert.equal(await box(page).evaluate((d) => d.open), true);
  await page.keyboard.press('Escape');
  await page.locator('#hero-q').fill('');
  await page.locator('#hero-q').press('/');
  assert.equal(await box(page).evaluate((d) => d.open), false);
  assert.equal(await page.locator('#hero-q').inputValue(), '/');
  await context.close();
});

test('on a phone it is the first line of the menu, in the page\'s language, and fits 320 px', async () => {
  const { context, page, problems } = await open('/ru/catalog/', 'mobile');
  assert.equal(await page.locator('.bar .search-btn').isVisible(), false, 'the phone header keeps its three things');
  await page.locator('.menu-btn').click();
  await page.locator('#menu .menu-search').click();
  assert.equal(await box(page).evaluate((d) => d.open), true);
  assert.equal(await page.locator('#menu').isHidden(), true, 'the menu folds away behind the box');
  assert.equal(await page.locator('#sitesearch-q').getAttribute('placeholder'), 'Мод, герой или автор');
  await page.setViewportSize({ width: 320, height: 640 });
  await ask(page, 'пудж');
  assert.equal(await page.locator('#sitesearch-list .ss-label').first().textContent(), 'Герои');
  assert.equal(await page.locator('#sitesearch-list a[href="/ru/heroes/pudge/"]').count(), 1);
  const over = await findOverflow(page);
  if (over.length) { await snap(page, 'search-320'); assert.fail(over.join('; ')); }
  const r = await box(page).boundingBox();
  assert.ok(r.x >= 0 && r.x + r.width <= 320, `the box spans ${Math.round(r.x)}..${Math.round(r.x + r.width)}`);
  assert.deepEqual(problems.filter((l) => !isOffline(l)), []);
  await context.close();
});

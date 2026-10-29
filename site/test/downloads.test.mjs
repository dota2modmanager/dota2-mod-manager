/**
 * The download numbers (src/scripts/downloads.ts): read from the catalog's counter, put on the
 * cards of a category page, of the whole catalog drawn from data, and on a mod's own page. A mod
 * with looks counts as all its looks together, the way the catalog's site counts them. And when
 * the counter cannot be reached, nothing shows and nothing breaks.
 *
 * The counter is stood in for; the test never reaches the real one.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, serveDist, launch, openPage, isOffline } from './harness.mjs';

const COUNTER = 'https://d2pfx-counter.hrdqfck.workers.dev/**';
const data = JSON.parse(fs.readFileSync(path.join(DIST, 'catalog', 'data.json'), 'utf-8'));
const catOf = (m) => data.cats[m[2]][0];
const keyOf = (m) => m[11] || `${catOf(m)}/${m[1]}`;
// a mod in a group (hero-items: its hero), with more than one look
const grouped = data.mods.find((m) => m[11] && m[7].split('|').length >= 2);
// a mod without a group, with one look
const plain = data.mods.find((m) => !m[11] && !m[7] && catOf(m) !== 'heroes');
const looks = grouped[7].split('|');

let server, browser;
before(async () => {
  server = await serveDist();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

/** A page with the counter answering `counts`, or refusing when counts is null. */
async function open(url, counts) {
  const { context, page, problems } = await openPage(browser, server.url, 'desktop', { motion: 'reduce' });
  let asked = 0;
  await context.route(COUNTER, async (route) => {
    asked++;
    if (!counts) return route.fulfill({ status: 503, body: 'down' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(counts) });
  });
  await page.goto(server.url + url, { waitUntil: 'load' });
  return { context, page, problems, asked: () => asked };
}

const numberOn = (page, key) => page.evaluate((k) => {
  const card = [...document.querySelectorAll('.mcard')].find((c) => c.dataset.count === k && !c.hidden);
  return card?.querySelector('.mcard-dl b')?.textContent ?? null;
}, key);

test('a card carries its counter key, with the group the catalog files it under', () => {
  const html = fs.readFileSync(path.join(DIST, 'catalog', catOf(grouped), 'index.html'), 'utf-8');
  assert.ok(keyOf(grouped).split('/').length === 3, keyOf(grouped));
  assert.ok(html.includes(`data-count="${keyOf(grouped)}"`), `no card for ${keyOf(grouped)}`);
});

test('a category page puts the number on its cards, all looks of a mod together', async () => {
  const k = keyOf(grouped);
  const { context, page, problems } = await open(`/catalog/${catOf(grouped)}/`, {
    [k]: 3, [`${k}/${looks[0] || 'Default'}`]: 1000, [`${k}/${looks[1]}`]: 250,
  });
  await page.waitForSelector('.mcard-dl');
  assert.equal(await numberOn(page, k), '1.2k');
  const chip = await page.evaluate((key) => {
    const c = document.querySelector(`.mcard[data-count="${CSS.escape(key)}"] .mcard-dl`);
    return { title: c.title, text: c.textContent.trim() };
  }, k);
  assert.match(chip.title, /Downloads: 1,250/);
  assert.match(chip.text, /^1\.2k downloads$/);
  // the plain key holds the app's hits, which the app also sends per look: the larger, not the sum
  // a mod nobody counted has no number, never a zero
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.mcard-dl b')].some((b) => b.textContent === '0')), false);
  assert.deepEqual(problems.filter((p) => !isOffline(p)), []);
  await context.close();
});

test('the whole catalog, drawn from data, numbers its cards too', async () => {
  const k = keyOf(plain);
  const { context, page, problems } = await open(`/ru/catalog/?q=${encodeURIComponent(plain[1])}`, { [k]: 15600 });
  await page.waitForFunction((key) => [...document.querySelectorAll('.mcard')].some((c) => c.dataset.count === key && c.querySelector('.mcard-dl')), k);
  assert.equal(await numberOn(page, k), '15k');
  assert.match(await page.evaluate(() => document.querySelector('.mcard-dl').title), /^Скачиваний: 15\s600$/);
  assert.deepEqual(problems.filter((p) => !isOffline(p)), []);
  await context.close();
});

test('a mod page says how many times it was downloaded, and so do the cards under it', async () => {
  const k = keyOf(plain);
  const near = data.mods.filter((m) => m !== plain && catOf(m) === catOf(plain)).map(keyOf);
  const { context, page } = await open(`/mods/${plain[0]}/`, { [k]: 4321, ...Object.fromEntries(near.map((n) => [n, 7])) });
  await page.waitForSelector('#mod-dl:not([hidden])');
  assert.deepEqual(await page.evaluate(() => [document.getElementById('mod-dl-label').textContent, document.getElementById('mod-dl').textContent]), ['Downloads', '4,321']);
  await page.waitForSelector('.mcard .mcard-dl');
  assert.ok(await page.locator('.mcard .mcard-dl').count() > 0);
  await context.close();
});

test('with the counter down, the cards and the page are what they were, and nothing breaks', async () => {
  for (const url of [`/catalog/${catOf(grouped)}/`, `/mods/${plain[0]}/`]) {
    const { context, page, problems, asked } = await open(url, null);
    await page.waitForLoadState('networkidle');
    assert.ok(asked() >= 1, `${url}: the counter was never asked`);
    assert.equal(await page.locator('.mcard-dl').count(), 0, url);
    if (url.startsWith('/mods/')) assert.equal(await page.locator('#mod-dl').isHidden(), true);
    assert.deepEqual(problems.filter((p) => !isOffline(p) && !/503/.test(p)), [], url);
    await context.close();
  }
});

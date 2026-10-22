/**
 * The offer of the other language (Base.astro): an English page offers its Russian twin to a
 * browser that prefers Russian, a Russian page offers its English twin to a browser with no
 * Russian at all, and any choice the visitor makes (the offer's link, its close button, any
 * language switch on the site) ends the offer for good. Nothing is ever redirected.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, serveDist, launch, openPage, findOverflow, isOffline, snap } from './harness.mjs';

const data = JSON.parse(fs.readFileSync(path.join(DIST, 'catalog', 'data.json'), 'utf-8'));
const modPath = `/mods/${data.mods[0][0]}/`;

let server, browser;
before(async () => {
  server = await serveDist();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(path, locale, screen = 'desktop') {
  const { context, page, problems } = await openPage(browser, server.url, screen, { motion: 'reduce', locale });
  await page.goto(server.url + path, { waitUntil: 'load' });
  return { context, page, problems };
}
const bar = (page) => page.locator('#langbar');

test('a Russian browser on an English page is offered the same page in Russian, and nowhere else', async () => {
  const { context, page, problems } = await open('/', 'ru-RU');
  for (const p of ['/', '/catalog/', modPath, '/docs/']) {
    await page.goto(server.url + p, { waitUntil: 'load' });
    assert.equal(await bar(page).isVisible(), true, `${p}: offered`);
    assert.equal(await bar(page).locator('a').getAttribute('href'), `/ru${p}`);
    assert.match(await bar(page).textContent(), /на русском/);
    assert.equal(page.url(), server.url + p, 'and not sent there');
  }
  // following it lands on the twin, which offers nothing back
  await bar(page).locator('a').click();
  await page.waitForURL(`${server.url}/ru/docs/`);
  assert.equal(await bar(page).isVisible(), false);
  // and the choice holds on the English pages too
  await page.goto(`${server.url}/`, { waitUntil: 'load' });
  assert.equal(await bar(page).isVisible(), false);
  assert.deepEqual(problems.filter((l) => !isOffline(l)), []);
  await context.close();
});

test('closing the offer ends it, on every page and after a reload', async () => {
  const { context, page } = await open('/heroes/', 'ru-RU');
  await bar(page).locator('[data-lang-stay]').click();
  assert.equal(await bar(page).isVisible(), false);
  await page.reload({ waitUntil: 'load' });
  assert.equal(await bar(page).isVisible(), false);
  await page.goto(`${server.url}/catalog/`, { waitUntil: 'load' });
  assert.equal(await bar(page).isVisible(), false);
  await context.close();
});

test('a language picked in the header counts as the choice, wherever it was picked', async () => {
  // a Russian browser that went to the English site on purpose, from a Russian page, is not
  // asked about Russian afterwards
  const { context, page } = await open('/ru/facts/', 'ru-RU');
  assert.equal(await bar(page).isVisible(), false, 'a Russian page offers a Russian browser nothing');
  await page.locator('.topbar .nav a.lang').click();
  await page.waitForURL(`${server.url}/facts/`);
  assert.equal(await page.evaluate(() => localStorage.getItem('mm-lang')), 'en', 'the switch was kept as the choice');
  assert.equal(await bar(page).isVisible(), false);
  await context.close();
});

test('an English browser is offered English on a Russian page, and nothing on an English one', async () => {
  for (const locale of ['en-US', 'de-DE']) {
    const { context, page } = await open('/ru/catalog/', locale);
    assert.equal(await bar(page).isVisible(), true, `${locale}: a Russian page offers English`);
    assert.equal(await bar(page).locator('a').getAttribute('href'), '/catalog/');
    assert.match(await bar(page).textContent(), /also in English/);
    await page.goto(`${server.url}/catalog/`, { waitUntil: 'load' });
    assert.equal(await bar(page).isVisible(), false, `${locale}: an English page offers nothing`);
    await context.close();
  }
  // the page for a missing address has no twin to offer
  const { context, page } = await open('/no-such-page/', 'ru-RU');
  assert.equal(await bar(page).count(), 0);
  await context.close();
});

test('the offer fits a 320 px phone and keeps the header in reach', async () => {
  const { context, page, problems } = await open('/', 'ru-RU', 'mobile');
  await page.setViewportSize({ width: 320, height: 640 });
  assert.equal(await bar(page).isVisible(), true);
  const over = await findOverflow(page);
  if (over.length) { await snap(page, 'langbar-320'); assert.fail(over.join('; ')); }
  const [b, head] = [await bar(page).boundingBox(), await page.locator('.topbar').boundingBox()];
  assert.ok(b.y + b.height <= head.y + 1, 'the offer sits above the header, not over it');
  assert.ok(b.height <= 72, `the offer takes ${Math.round(b.height)} px of a phone`);
  // the close button is big enough for a thumb
  const x = await bar(page).locator('[data-lang-stay]').boundingBox();
  assert.ok(x.width >= 32 && x.height >= 32);
  assert.deepEqual(problems.filter((l) => !isOffline(l)), []);
  await context.close();
});

/**
 * The catalog, the heroes and a category, pressed the way a visitor presses them: the search, the
 * groups and kinds, the orders, the next screen of cards, the closer look at one mod, and the set
 * that goes to the app.
 *
 * The set's link is read back with the app's own decoder (src/preset-link.ts), so a link built on
 * the site is held to what the app will actually open.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveDist, launch, openPage, findOverflow, isOffline, snap } from './harness.mjs';
import { decodePresetLink } from '../../src/preset-link.ts';

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

/** The catalog page has swapped its first HTML cards for the ones it draws from data. */
const ready = (page) => page.waitForFunction(() => document.querySelectorAll('#browse-grid .mcard').length >= 48 && !document.getElementById('browse-count')?.textContent?.includes('48 of'));
const cards = (page) => page.locator('#browse-grid .mcard:not([hidden])');
const attr = (page, name) => cards(page).evaluateAll((els, n) => els.map((e) => e.dataset[n]), name);

test('the catalog searches, filters by group and kind, sorts, and keeps it all in the address', async () => {
  const { context, page, problems } = await open('/catalog/');
  await ready(page);

  await page.locator('#browse-q').fill('pudge');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('q') === 'pudge');
  const hays = await attr(page, 'hay');
  assert.ok(hays.length > 0);
  for (const h of hays) assert.match(h, /pudge/);
  assert.match(await page.locator('#browse-count').textContent(), new RegExp(`${hays.length}`));

  await page.locator('#browse-clear').click();
  assert.equal(await page.locator('#browse-q').inputValue(), '');

  await page.locator('[data-group-filter="world"]').click();
  for (const g of await attr(page, 'group')) assert.equal(g, 'world');
  // the kinds on offer are the world's now
  const kinds = await page.locator('#browse-cats .chip:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.group));
  assert.ok(kinds.length > 0 && kinds.every((g) => g === 'world'));

  await page.locator('#browse-cats [data-cat="terrains"]').click();
  for (const c of await attr(page, 'cat')) assert.equal(c, 'terrains');
  assert.match(page.url(), /cat=terrains/);

  await page.locator('#browse-sort').selectOption('az');
  const names = await attr(page, 'name');
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

  // the same address opens the same view
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => [...document.querySelectorAll('#browse-grid .mcard')].every((e) => e.dataset.cat === 'terrains'));
  assert.equal(await page.locator('#browse-sort').inputValue(), 'az');

  assert.deepEqual(problems.filter((l) => !isOffline(l)), []);
  await context.close();
});

test('the catalog comes in pages of 48, keeps the page in the address, and never grows past one', async () => {
  for (const screen of ['desktop', 'mobile']) {
    const { context, page, problems } = await open('/catalog/', screen);
    await ready(page);
    const keys = () => cards(page).evaluateAll((els) => els.map((e) => e.dataset.key));
    const first = await keys();
    assert.equal(first.length, 48);
    // scrolling to the bottom adds nothing: the footer is reachable
    await page.locator('footer').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    assert.equal(await cards(page).count(), 48, `${screen}: no cards arrive on their own`);

    await page.locator('#browse-next').click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get('page') === '2');
    const second = await keys();
    assert.equal(second.length, 48);
    assert.ok(second.every((k) => !first.includes(k)), 'page 2 is the next 48, not the same ones');
    assert.match(await page.locator('#browse-where').textContent(), /49.96/);
    // and the grid's top is back in view
    const top = await page.locator('#browse').evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(top > -20 && top < 200, `${screen}: the grid starts at ${Math.round(top)} px`);

    // Back goes to page 1
    await page.goBack();
    await page.waitForFunction((k) => document.querySelector('#browse-grid .mcard')?.dataset.key === k, first[0]);

    const total = await page.evaluate(() => fetch('/catalog/data.json').then((r) => r.json()).then((d) => d.mods.length));
    const pages = Math.ceil(total / 48);
    if (screen === 'desktop') {
      // the last page holds what is left
      await page.locator(`#browse-pages [data-page="${pages}"]`).click();
      await page.waitForFunction((p) => new URLSearchParams(location.search).get('page') === String(p), pages);
      assert.equal(await cards(page).count(), total - 48 * (pages - 1));
      assert.equal(await page.locator('#browse-next').isDisabled(), true);
      assert.equal(await page.locator('#browse-pages [aria-current="page"]').textContent(), String(pages));
    } else {
      // a phone says which page in words instead of numbers
      assert.equal(await page.locator('#browse-pages').isVisible(), false);
      assert.match(await page.locator('#browse-now').textContent(), new RegExp(`1\\D+${pages}`));
    }

    // a search starts from its own first page
    await page.goto(`${server.url}/catalog/?page=3`, { waitUntil: 'load' });
    await ready(page);
    await page.waitForFunction(() => document.getElementById('browse-where')?.textContent?.includes('97'));
    await page.locator('#browse-q').fill('pudge');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('q') === 'pudge' && !new URLSearchParams(location.search).get('page'));
    assert.deepEqual(problems.filter((l) => !isOffline(l)), []);
    await context.close();
  }
});

test('a closer look at a mod opens, has its own address, and closes on Escape', async () => {
  for (const screen of ['desktop', 'mobile']) {
    const { context, page } = await open('/catalog/', screen);
    await ready(page);
    const first = cards(page).first();
    const name = await first.locator('h2').textContent();
    await first.locator('[data-open]').click();
    const quick = page.locator('#quick[open]');
    await quick.waitFor();
    assert.equal(await page.locator('#quick-title').textContent(), name);
    assert.match(page.url(), /#mod=/);
    await page.waitForFunction(() => document.getElementById('quick-app')?.getAttribute('href')?.startsWith('d2mm://preset/'));
    const code = (await page.locator('#quick-app').getAttribute('href')).replace('d2mm://preset/', '');
    assert.equal(decodePresetLink(code).mods[0].name, name);
    const over = await findOverflow(page);
    if (over.length) { await snap(page, `quick-${screen}`); assert.fail(over.join('; ')); }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#quick').evaluate((d) => d.open), false);
    // the dialog's close event, which takes the #mod= off the address, comes a moment later
    await page.waitForFunction(() => !location.hash.startsWith('#mod='));

    // and the address opens it again
    const key = await first.evaluate((li) => li.dataset.key);
    await page.goto(`${server.url}/catalog/#mod=${key}`, { waitUntil: 'load' });
    await page.locator('#quick[open]').waitFor();
    assert.equal(await page.locator('#quick-title').textContent(), name);
    await context.close();
  }
});

test('a set picked across pages becomes one link the app opens', async () => {
  const { context, page } = await open('/catalog/');
  await ready(page);
  const picks = cards(page);
  const a = await picks.nth(0).evaluate((li) => ({ key: li.dataset.key, name: li.querySelector('h2').textContent }));
  const b = await picks.nth(3).evaluate((li) => ({ key: li.dataset.key, name: li.querySelector('h2').textContent }));
  await picks.nth(0).locator('[data-add]').click();
  await picks.nth(3).locator('[data-add]').click();
  assert.equal(await picks.nth(0).getAttribute('class'), 'mcard picked');

  const tray = page.locator('#tray');
  await tray.waitFor();
  assert.match(await page.locator('#tray-count').textContent(), /2/);

  // a hero page adds to the same set
  await page.goto(`${server.url}/heroes/pudge/`, { waitUntil: 'load' });
  await tray.waitFor();
  const c = await cards(page).first().evaluate((li) => ({ key: li.dataset.key, name: li.querySelector('h2').textContent }));
  await cards(page).first().locator('[data-add]').click();
  assert.match(await page.locator('#tray-count').textContent(), /3/);

  await page.waitForFunction(() => document.getElementById('tray-app')?.getAttribute('href')?.startsWith('d2mm://preset/'));
  const code = (await page.locator('#tray-app').getAttribute('href')).replace('d2mm://preset/', '');
  const preset = decodePresetLink(code);
  assert.deepEqual(preset.mods.map((m) => m.name).sort(), [a.name, b.name, c.name].sort());
  assert.ok(preset.mods.every((m) => m.kind === 'catalog' && m.categoryId));

  // Clear empties it everywhere
  await page.goto(`${server.url}/catalog/`, { waitUntil: 'load' });
  await tray.waitFor();
  await page.locator('#tray-clear').click();
  assert.equal(await tray.isHidden(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('mm-set')), '[]');

  // and the same code is what /p/ shows to somebody without the app. Last, because the page
  // hands itself to d2mm:// and headless Chrome takes no more clicks after that.
  await page.goto(`${server.url}/p/#${code}`, { waitUntil: 'commit' });
  await page.locator('.card').first().waitFor();
  assert.equal(await page.locator('.card').count(), 3);
  await context.close();
});

test('a hero page narrows to the part a mod replaces', async () => {
  const { context, page } = await open('/heroes/pudge/');
  const all = await cards(page).count();
  const weapon = page.locator('[data-slot="weapon"]');
  if (!(await weapon.count())) return;
  await weapon.click();
  const slots = await attr(page, 'slots');
  assert.ok(slots.length > 0 && slots.length <= all);
  for (const s of slots) assert.match(s, /\bweapon\b/);
  await page.locator('[data-slot=""]').click();
  assert.equal(await cards(page).count(), all);
  await context.close();
});

test('a category page searches its own cards without the catalog file', async () => {
  const { context, page } = await open('/catalog/terrains/');
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const all = await cards(page).count();
  const word = (await cards(page).first().locator('h2').textContent()).split(/\s+/)[0].toLowerCase();
  await page.locator('#browse-q').fill(word);
  await page.waitForFunction((n) => document.querySelectorAll('#browse-grid .mcard:not([hidden])').length < n, all);
  for (const h of await attr(page, 'hay')) assert.match(h, new RegExp(word));
  assert.equal(requests.some((u) => u.endsWith('/catalog/data.json')), false, 'a category page fetched the whole catalog to search itself');
  await context.close();
});

test('the heroes are found by their Russian names and nicknames, in any order', async () => {
  const { context, page } = await open('/ru/heroes/');
  await page.locator('#hero-q').fill('пудж');
  const shown = await page.locator('#heroGrid li:not([hidden]) .htile-text').allTextContents();
  assert.ok(shown.length >= 1);
  // the tile says Pudge, as the game does, and Пудж under it, as players do
  assert.ok(shown.some((t) => /Pudge/.test(t) && /Пудж/.test(t)), shown.join(' | '));
  await page.locator('#hero-q').fill('');
  await page.locator('#hero-sort').selectOption('az');
  const names = await page.locator('#heroGrid li b').allTextContents();
  assert.deepEqual(names, [...names].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())));
  await context.close();
});

test('the menu on a phone opens, leads somewhere, and closes', async () => {
  const { context, page } = await open('/docs/', 'mobile');
  const btn = page.locator('.menu-btn');
  assert.equal(await page.locator('.topbar .nav').isVisible(), false, 'the desktop links are hidden on a phone');
  await btn.tap();
  const menu = page.locator('#menu');
  assert.equal(await menu.isVisible(), true);
  assert.equal(await btn.getAttribute('aria-expanded'), 'true');
  assert.ok((await menu.locator('a').count()) >= 5);
  await page.keyboard.press('Escape');
  assert.equal(await menu.isVisible(), false);
  await btn.tap();
  await menu.locator('a[href$="/catalog/"]').tap();
  await page.waitForURL(/\/catalog\/$/);
  await context.close();
});

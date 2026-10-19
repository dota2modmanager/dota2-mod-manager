/**
 * A mod's own page (/mods/<key>/), the page a link to one mod opens: the head a chat's preview
 * reads, the picture and its styles, the app link for the style on show (read back with the app's
 * own decoder), the set it shares with the catalog, the link it sends on, and the cards under it.
 * And the way there: a card's picture is a link to the page, and the closer look offers it.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DIST, serveDist, launch, openPage, findOverflow, isOffline, snap } from './harness.mjs';
import { decodePresetLink } from '../../src/preset-link.ts';
import { parseModLink } from '../../src/deep-links.ts';

const ORIGIN = 'https://dota2modmanager.com';
const data = JSON.parse(fs.readFileSync(path.join(DIST, 'catalog', 'data.json'), 'utf-8'));
const catOf = (m) => data.cats[m[2]][0];
// a hero's mod in several styles, and a mod from a category of its own with one look
const styled = data.mods.find((m) => m[3] >= 0 && m[7].split('|').length >= 2 && m[4]);
const single = data.mods.find((m) => m[3] < 0 && !m[7] && m[4] && catOf(m) !== 'heroes');
const page = (lang, m) => `${lang === 'ru' ? '/ru' : ''}/mods/${m[0]}/`;
const read = (p) => fs.readFileSync(path.join(DIST, p, 'index.html'), 'utf-8');
const meta = (body, prop) => body.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];

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
  const { context, page: p, problems } = await openPage(browser, server.url, screen, { motion: 'reduce' });
  await p.goto(server.url + path, { waitUntil: 'load' });
  return { context, page: p, problems };
}
/* What the app opens from a mod page's button, read with the app's own code: the mod's own link
   once a released app reads one (lib/preset.ts openInApp), a preset of that one mod before. */
const decode = (href) => {
  if (href.startsWith('d2mm://mod/')) { const m = parseModLink(href); return m && { categoryId: m.cat, name: m.name, styleLabel: m.style }; }
  const preset = decodePresetLink(href.replace('d2mm://preset/', ''));
  assert.equal(preset.mods.length, 1, 'a preset of the one mod');
  return preset.mods[0];
};

test('a mod page tells a chat what to show: its own picture, at its real size, and its own address', async () => {
  assert.ok(styled && single, 'the catalog has a styled hero mod and a one-look category mod to test with');
  for (const m of [styled, single]) {
    for (const lang of ['en', 'ru']) {
      const p = page(lang, m);
      const body = read(p);
      const img = meta(body, 'og:image');
      assert.equal(img, `${ORIGIN}/mods/${m[4]}.webp`, `${p}: the preview is the mod's picture`);
      const { width, height } = await sharp(path.join(DIST, new URL(img).pathname)).metadata();
      assert.equal(`${meta(body, 'og:image:width')}x${meta(body, 'og:image:height')}`, `${width}x${height}`, `${p}: the size the head states`);
      // addresses compared as text: in a pattern the dots of the domain would match anything
      const twin = lang === 'ru' ? 'en' : 'ru';
      assert.ok(body.includes(`<link rel="canonical" href="${ORIGIN}${p}"`), `${p}: its own canonical address`);
      assert.ok(body.includes(`hreflang="${twin}" href="${ORIGIN}${page(twin, m)}"`), `${p}: its twin in ${twin}`);
      assert.ok(meta(body, 'og:title').includes(m[1]), `${p}: the title names the mod`);
      // the structured data parses, and says the same picture and the same mod
      const nodes = [...body.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((x) => JSON.parse(x[1]));
      const item = nodes.find((n) => n['@type'] === 'ItemPage');
      assert.equal(item.mainEntity.name, m[1]);
      assert.equal(item.primaryImageOfPage.contentUrl, img);
      assert.ok(nodes.some((n) => n['@type'] === 'BreadcrumbList'));
    }
  }
  // and a search engine is told about the page and its pictures
  const map = fs.readFileSync(path.join(DIST, 'sitemap-0.xml'), 'utf-8');
  assert.ok(map.includes(`<loc>${ORIGIN}/mods/${styled[0]}/</loc>`), 'the sitemap lists the page');
  assert.ok(map.includes(`<image:loc>${ORIGIN}/mods/${styled[4]}.webp</image:loc>`), 'and its picture');
});

test('a mod page switches styles, opens the style on show in the app, and keeps the set', async () => {
  for (const screen of ['desktop', 'mobile']) {
    const { context, page: p, problems } = await open(page('en', styled), screen);
    assert.equal(await p.locator('h1').textContent(), styled[1]);
    const looks = p.locator('.mod-look');
    assert.ok((await looks.count()) >= 2);
    assert.equal(await looks.first().getAttribute('aria-pressed'), 'true');

    // a phone cannot run the app: it is offered the link to send on, a computer the app
    const phone = screen === 'mobile';
    assert.equal(await p.locator('#mod-app').isVisible(), !phone);
    assert.equal(await p.locator('.mod-note-touch').isVisible(), phone);
    const [shareBox, addBox] = [await p.locator('#mod-share').boundingBox(), await p.locator('#mod-add').boundingBox()];
    if (phone) assert.ok(shareBox.y < addBox.y, 'on a phone, sending the link comes first');

    // the app link opens this mod, in the style the page shows
    const first = decode(await p.locator('#mod-app').getAttribute('href'));
    assert.equal(first.categoryId, catOf(styled));
    assert.equal(first.name, styled[1]);

    const second = looks.nth(1);
    await second.click();
    assert.equal(await second.getAttribute('aria-pressed'), 'true');
    assert.equal(await looks.first().getAttribute('aria-pressed'), 'false');
    assert.equal(await p.locator('#mod-img').getAttribute('src'), await second.getAttribute('data-img'));
    const now = decode(await p.locator('#mod-app').getAttribute('href'));
    assert.notEqual(now.styleLabel, first.styleLabel, 'the second style opens, not the first');
    assert.equal(now.name, styled[1]);

    // the set is the catalog's: the button, and the cards under the mod
    await p.locator('#mod-add').click();
    assert.equal(await p.locator('#mod-add').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await p.evaluate(() => JSON.parse(localStorage.getItem('mm-set'))), [styled[0]]);
    assert.match(await p.locator('#mod-set').textContent(), /1 mod in your set/);
    const card = p.locator('.mod-more .mcard').first();
    assert.match(await card.locator('[data-open]').getAttribute('href'), /^\/mods\/[a-z0-9-]+\/$/);
    await card.locator('[data-add]').click();
    assert.equal(await card.getAttribute('class'), 'mcard picked');
    assert.match(await p.locator('#mod-set').textContent(), /2 mods in your set/);

    const over = await findOverflow(p);
    if (over.length) { await snap(p, `mod-${screen}`); assert.fail(over.join('; ')); }
    assert.deepEqual(problems.filter((l) => !isOffline(l)), []);

    // the catalog's tray holds the two
    await p.goto(`${server.url}/catalog/`, { waitUntil: 'load' });
    await p.locator('#tray').waitFor();
    assert.match(await p.locator('#tray-count').textContent(), /2/);

    // a card under the mod is a way to that mod's own page
    await p.goto(server.url + page('en', styled), { waitUntil: 'load' });
    const next = await card.locator('[data-open]').getAttribute('href');
    await card.locator('h3').click();
    await p.waitForURL(`${server.url}${next}`);
    await context.close();
  }
});

test('a mod page copies its own address, in either language', async () => {
  for (const lang of ['en', 'ru']) {
    const { context, page: p } = await open(page(lang, single));
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
    await p.locator('#mod-share').click();
    await p.locator('.toast').waitFor();
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), `${server.url}${page(lang, single)}`);
    assert.equal(await p.locator('.toast').textContent(), lang === 'ru' ? 'Ссылка скопирована' : 'Link copied');
    // one style: no switch, and the app link names no style
    assert.equal(await p.locator('.mod-look').count(), 0);
    const mod = decode(await p.locator('#mod-app').getAttribute('href'));
    assert.deepEqual([mod.categoryId, mod.name, mod.styleLabel], [catOf(single), single[1], null]);
    await context.close();
  }
});

test('a card leads to its mod page: a plain click looks closer, a new tab gets the page', async () => {
  const { context, page: p } = await open('/catalog/');
  await p.waitForFunction(() => document.querySelectorAll('#browse-grid .mcard').length >= 48);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
  const card = p.locator('#browse-grid .mcard').first();
  const key = await card.getAttribute('data-key');
  const pic = card.locator('[data-open]');
  assert.equal(await pic.getAttribute('href'), `/mods/${key}/`);

  await pic.click();
  await p.locator('#quick[open]').waitFor();
  assert.match(p.url(), /\/catalog\/#mod=/, 'a plain click stays on the catalog');
  assert.equal(await p.locator(`#quick-links a[href="/mods/${key}/"]`).count(), 1);
  await p.locator('#quick-copy').click();
  assert.equal(await p.evaluate(() => navigator.clipboard.readText()), `${server.url}/mods/${key}/`);
  await p.keyboard.press('Escape');

  const [tab] = await Promise.all([context.waitForEvent('page'), pic.click({ modifiers: ['Control'] })]);
  await tab.waitForLoadState('load');
  assert.equal(new URL(tab.url()).pathname, `/mods/${key}/`);
  assert.equal(await p.locator('#quick').evaluate((d) => d.open), false, 'and the catalog did not open its closer look');
  await context.close();
});

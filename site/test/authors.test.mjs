/**
 * The authors (src/lib/authors.ts): a page for everybody with three or more mods, in both
 * languages, holding exactly their mods; the index of them, most mods first; every "by" on the
 * site leading to that page when there is one and to the profile when there is not. And the plain
 * look of a mod in several looks, which the catalog's cards and closer look used to drop.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, serveDist, launch, openPage, isOffline } from './harness.mjs';
import { decodePresetLink } from '../../src/preset-link.ts';

const data = JSON.parse(fs.readFileSync(path.join(DIST, 'catalog', 'data.json'), 'utf-8'));
const read = (p) => fs.readFileSync(path.join(DIST, p, 'index.html'), 'utf-8');
const exists = (p) => fs.existsSync(path.join(DIST, p, 'index.html'));

/* the catalog's authors, as the build should have grouped them: by name, without case */
const groups = new Map();
for (const m of data.mods) {
  if (!m[5]) continue;
  const k = m[5].trim().toLowerCase();
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(m);
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

test('everybody with three or more mods has a page in both languages, holding exactly their mods', () => {
  let pages = 0;
  for (const mods of groups.values()) {
    const slugs = new Set(mods.map((m) => m[10]));
    assert.equal(slugs.size, 1, `${mods[0][5]}: one page for all their mods`);
    const slug = [...slugs][0];
    if (mods.length < 3) { assert.equal(slug, '', `${mods[0][5]} has ${mods.length} mods and no page`); continue; }
    pages++;
    for (const p of [`authors/${slug}`, `ru/authors/${slug}`]) {
      assert.ok(exists(p), `/${p}/ was built`);
      const body = read(p);
      const keys = [...body.matchAll(/<li class="mcard"[^>]* data-key="([^"]+)"/g)].map((x) => x[1]).sort();
      assert.deepEqual(keys, mods.map((m) => m[0]).sort(), `/${p}/ lists their mods and nobody else's`);
      // the cards do not say "by" on a page that is all one author's
      assert.doesNotMatch(body, /class="mcard-meta"><span>(by|автор) /);
    }
  }
  assert.ok(pages >= 10, `${pages} author pages`);
  // and the index has them all, most mods first
  for (const p of ['authors', 'ru/authors']) {
    const body = read(p);
    const tiles = [...body.matchAll(/<a class="htile" href="[^"]*\/authors\/([^/]+)\/"/g)].map((x) => x[1]);
    assert.equal(tiles.length, pages);
    const counts = [...body.matchAll(/<span class="htile-count">([\d\s ]+)/g)].map((x) => Number(x[1].replace(/\D/g, '')));
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a), `/${p}/: most mods first`);
  }
});

test('an author page says who they are and leads to their profile', () => {
  const [mods] = [...groups.values()].filter((g) => g.length >= 3 && g.some((m) => m[9])).sort((a, b) => b.length - a.length);
  const slug = mods[0][10];
  const body = read(`authors/${slug}`);
  assert.match(body, new RegExp(`<h1>Mods by ${mods[0][5].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`));
  const url = mods.map((m) => m[9]).find(Boolean);
  assert.ok(body.includes(`href="${url}"`) || mods.some((m) => m[9] && body.includes(`href="${m[9]}"`)), 'the profile is linked');
  const nodes = [...body.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((x) => JSON.parse(x[1]));
  const profile = nodes.find((n) => n['@type'] === 'ProfilePage');
  assert.equal(profile.mainEntity['@type'], 'Person');
  assert.equal(profile.mainEntity.name, mods[0][5]);
  assert.equal(profile.hasPart.numberOfItems, mods.length);
});

test("a mod's \"made by\" leads to the author's page, or to their profile when they have none", () => {
  // the facts beside the picture, not the cards of other mods under it
  const facts = (key) => read(`mods/${key}`).match(/<dl class="mod-facts">[^]*?<\/dl>/)[0];
  const withPage = data.mods.find((m) => m[10] && m[9]);
  assert.ok(facts(withPage[0]).includes(`href="/authors/${withPage[10]}/"`), 'to the page');
  assert.ok(facts(withPage[0]).includes(`href="${withPage[9]}"`), 'and still to the profile');
  const without = data.mods.find((m) => m[5] && !m[10] && m[9]);
  if (without) {
    assert.ok(facts(without[0]).includes(`href="${without[9]}"`));
    assert.ok(!facts(without[0]).includes('href="/authors/'), 'no page to lead to');
  }
});

test('the catalog drawn from data leads to author pages, in the cards and the closer look', async () => {
  const { context, page, problems } = await openPage(browser, server.url, 'desktop', { motion: 'reduce' });
  await page.goto(`${server.url}/catalog/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#browse-grid .mcard').length >= 48 && !document.getElementById('browse-count')?.textContent?.includes('48 of'));
  const withPage = data.mods.find((m) => m[10]);
  // a card drawn by the script for a mod whose author has a page
  await page.locator('#browse-q').fill(withPage[1]);
  const card = page.locator(`#browse-grid .mcard[data-key="${withPage[0]}"]`);
  await card.waitFor();
  assert.equal(await card.locator('.mcard-meta a').first().getAttribute('href'), `/authors/${withPage[10]}/`);
  await card.locator('[data-open]').click();
  await page.locator('#quick[open]').waitFor();
  assert.equal(await page.locator(`#quick-facts a[href="/authors/${withPage[10]}/"]`).count(), 1);
  assert.deepEqual(problems.filter((l) => !isOffline(l)), []);
  await context.close();
});

test('a mod with an unnamed look offers it in the catalog, as the app calls it', async () => {
  const plain = data.mods.find((m) => m[7].startsWith('|'));
  assert.ok(plain, 'the catalog has a mod with a plain look and named ones');
  const { context, page } = await openPage(browser, server.url, 'desktop', { motion: 'reduce' });
  await page.goto(`${server.url}/catalog/#mod=${plain[0]}`, { waitUntil: 'load' });
  await page.locator('#quick[open]').waitFor();
  assert.match(await page.locator('#quick-facts').textContent(), /Default/);
  await page.waitForFunction(() => document.getElementById('quick-app')?.getAttribute('href')?.startsWith('d2mm://preset/'));
  const mod = decodePresetLink((await page.locator('#quick-app').getAttribute('href')).replace('d2mm://preset/', '')).mods[0];
  assert.equal(mod.name, plain[1]);
  assert.equal(mod.styleLabel, null, 'the plain look, which the app finds as category|name|');
  await context.close();
  // and the card names it in the HTML grids too
  const hero = data.heroes[plain[3]]?.[0];
  if (hero) assert.match(read(`heroes/${hero}`), new RegExp(`data-key="${plain[0]}"[^]*?<span class="mcard-style">Default \\+\\d`));
});

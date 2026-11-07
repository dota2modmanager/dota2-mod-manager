/**
 * Mods the catalog tags 18+ are on no page of the site, and the catalog lists them only after asking.
 *
 * In November 2026 the landing's Pudge tile showed "Pudge With A Penis": the tile took the hero's
 * newest picture, and nothing on the site knew the tag. The app hides these mods until the user
 * says they are 18 and want them (renderer/core/adult.ts). The site leaves them off every page
 * (src/lib/heroes.ts, src/lib/categories.ts) and the catalog's browser lists them once the visitor
 * presses 18+ and says yes (src/scripts/adult.ts). The tag comes from tools/catalog.mjs; this reads
 * the same data the pages were built from.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, builtPages, serveDist, launch, openPage } from './harness.mjs';

const source = (f) => JSON.parse(fs.readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf-8'));
const adult = [
  ...source('heroes.json').heroes.flatMap((h) => h.mods),
  ...source('categories.json').categories.flatMap((c) => c.mods),
].filter((m) => m.adult);
/* the picture's file name without its folder: the same file is under /mods/ and /mods/t/ */
const pictures = [...new Set(adult.flatMap((m) => (m.image ? [path.basename(m.image.src, '.webp')] : [])))];
const names = [...new Set(adult.map((m) => m.name))];

const files = () => [...builtPages().map((p) => (p.endsWith('/') ? `${p}index.html` : p)), '/llms.txt'];

test('no page or llms.txt names an 18+ mod or shows its picture', (t) => {
  if (!adult.length) return t.skip('the data has no mod tagged 18+');
  const bad = [];
  for (const f of files()) {
    const file = path.join(DIST, f);
    if (!fs.existsSync(file)) continue;
    const body = fs.readFileSync(file, 'utf-8');
    for (const pic of pictures) if (body.includes(`${pic}.webp`)) bad.push(`${f}: picture ${pic}`);
    for (const name of names) if (body.includes(name)) bad.push(`${f}: ${name}`);
  }
  assert.deepEqual(bad, []);
});

test("the landing's hero tiles each show a picture of their own", () => {
  for (const p of ['/index.html', '/ru/index.html']) {
    const body = fs.readFileSync(path.join(DIST, p), 'utf-8');
    const pics = [...body.matchAll(/class="htile"[^>]*>\s*<img src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(pics.length >= 6, `${p}: ${pics.length} hero tiles`);
    assert.equal(new Set(pics).size, pics.length, `${p}: two heroes share a picture: ${pics.join(', ')}`);
  }
});

test("the catalog's data keeps the 18+ mods apart from the rest", (t) => {
  if (!adult.length) return t.skip('the data has no mod tagged 18+');
  const data = JSON.parse(fs.readFileSync(path.join(DIST, 'catalog', 'data.json'), 'utf-8'));
  assert.deepEqual(data.mods.filter((r) => names.includes(r[1])).map((r) => r[1]), []);
  assert.deepEqual([...new Set(data.adult.map((r) => r[1]))].sort(), [...names].sort());
  for (const r of data.adult) assert.match(r[0], /^18-/, 'a key no page has');
});

let server, browser;
before(async () => { server = await serveDist(); browser = await launch(); });
after(async () => { await browser?.close(); await server?.close(); });

test('the catalog lists the 18+ mods only after the visitor says they are 18, and hides them again', async (t) => {
  if (!adult.length) return t.skip('the data has no mod tagged 18+');
  const { context, page } = await openPage(browser, server.url, 'desktop', { motion: 'reduce' });
  await page.goto(`${server.url}/catalog/?q=${encodeURIComponent(names[0])}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('browse-count')?.textContent?.includes('48 of'));
  const shown = () => page.locator('#browse-grid .mcard').evaluateAll((els) => els.map((e) => e.querySelector('h2')?.textContent));
  assert.ok(!(await shown()).includes(names[0]), 'listed before anybody asked');

  // "Don't show" keeps them hidden and nothing is remembered
  await page.locator('#browse-adult').click();
  await page.locator('#adult-ask[open]').waitFor();
  await page.locator('#adult-ask [data-adult-no]').click();
  assert.ok(!(await shown()).includes(names[0]));
  assert.equal(await page.locator('#browse-adult').getAttribute('aria-pressed'), 'false');

  await page.locator('#browse-adult').click();
  await page.locator('#adult-ask [data-adult-yes]').click();
  await page.waitForFunction((n) => [...document.querySelectorAll('#browse-grid .mcard h2')].some((h) => h.textContent === n), names[0]);
  // its card opens the closer look, since it has no page
  const href = await page.locator('#browse-grid .mcard', { hasText: names[0] }).first().locator('.mcard-pic').getAttribute('href');
  assert.match(href, /^#mod=18-/);

  // remembered: a new visit lists them without asking, and 18+ pressed again hides them
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction((n) => [...document.querySelectorAll('#browse-grid .mcard h2')].some((h) => h.textContent === n), names[0]);
  await page.locator('#browse-adult').click();
  assert.equal(await page.locator('#adult-ask').evaluate((d) => d.open), false, 'asked again to hide');
  assert.ok(!(await shown()).includes(names[0]));
  await context.close();
});

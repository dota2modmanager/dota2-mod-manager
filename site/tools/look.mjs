#!/usr/bin/env node
/**
 * Photographs the built site the way it is read: every kind of page, on a desktop and on a phone,
 * plus the landing with its menus open. The pictures are for looking at, by a person or by an
 * assistant asked to review the site; the tests in test/ are what pass or fail.
 *
 * A full page is shot with reduced motion. The sections rise in as they scroll into view, and a
 * picture of the whole page taken from the top has everything below the first screen still
 * waiting to rise, which is a picture of nothing. The menu shots keep the motion on, since that
 * is where the download menu went wrong.
 *
 * Long pages are cut into slices a screen or two tall, so each picture can be read at its size.
 * Everything lands in test-output/look/ with an index.html that shows them side by side.
 *
 * Usage, from site/ after npm run build:
 *   node tools/look.mjs                  every sample page, both screens
 *   node tools/look.mjs --only docs      pages whose path contains "docs"
 *   node tools/look.mjs --screen mobile  one screen
 *   node tools/look.mjs --online         let the pages reach GitHub and YouTube
 *   node tools/look.mjs --dist <dir> --out <dir>
 *                                        another build, e.g. main's, for a before and after
 */
import fs from 'node:fs';
import path from 'node:path';
import { serveDist, launch, openPage, samplePages, SCREENS, OUT, isOffline } from '../test/harness.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--only');
const screens = opt('--screen') ? [opt('--screen')] : Object.keys(SCREENS);
const online = args.includes('--online');
const dist = opt('--dist') ? path.resolve(opt('--dist')) : undefined;
const out = opt('--out') ? path.resolve(opt('--out')) : path.join(OUT, 'look');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const server = await serveDist(dist);
const browser = await launch();
const shots = [];
const trouble = [];

const slug = (p) => (p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').replace(/[/.]/g, '-'));

/** Scroll the whole page once, so lazy pictures load before the shot. */
async function settle(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
}

async function full(page, name, screen) {
  const { width, height } = SCREENS[screen].viewport;
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  /* A phone is shot a screen at a time, scrolled. For a full-page picture Chromium resizes the
     page and drops the touch screen while it does, so (hover: none) stops matching and the page
     is drawn as a narrow desktop: the header showed Download where every phone shows Catalog. */
  if (screen === 'mobile') {
    for (let y = 0, k = 1; y < total; y += height, k++) {
      await page.evaluate((top) => scrollTo(0, top), y);
      await page.waitForTimeout(150);
      const file = `${name}.${screen}.${String(k).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(out, file) });
      shots.push({ file, page: name, screen });
    }
    await page.evaluate(() => scrollTo(0, 0));
    return;
  }
  const step = height * 2;
  for (let y = 0, k = 1; y < total; y += step, k++) {
    const file = `${name}.${screen}.${String(k).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(out, file), fullPage: true, clip: { x: 0, y, width, height: Math.min(step, total - y) } });
    shots.push({ file, page: name, screen });
  }
}

/** The landing's moving parts, opened one at a time and shot as the screen shows them. */
const STATES = {
  'download-top': async (page) => {
    await page.locator('.hero .dl > summary').click();
    await page.waitForTimeout(250);
  },
  'download-bottom': async (page) => {
    const s = page.locator('.final .dl > summary');
    await s.scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, innerHeight / 4));
    await page.waitForTimeout(400);
    await s.click();
    await page.waitForTimeout(250);
  },
  'header-cta': async (page) => {
    await page.locator('.topbar .cta:visible').first().click();
    await page.waitForTimeout(900);
  },
};

for (const screen of screens) {
  for (const p of samplePages(dist).filter((x) => !only || x.includes(only))) {
    const { context, page, problems } = await openPage(browser, server.url, screen, { motion: 'reduce', online });
    await page.goto(server.url + p, { waitUntil: 'load' });
    await settle(page);
    await full(page, slug(p), screen);
    const real = problems.filter((l) => online || !isOffline(l));
    if (real.length) trouble.push(`${p} on ${screen}:\n  ${real.join('\n  ')}`);
    await context.close();
  }

  if (!only || '/'.includes(only) || only === 'home') {
    for (const lang of ['', '/ru']) {
      for (const [state, act] of Object.entries(STATES)) {
        const { context, page } = await openPage(browser, server.url, screen, { online });
        await page.goto(`${server.url}${lang}/`, { waitUntil: 'load' });
        await act(page);
        const file = `state-${lang ? 'ru-' : ''}${state}.${screen}.png`;
        await page.screenshot({ path: path.join(out, file) });
        shots.push({ file, page: `${lang || 'en'} ${state}`, screen });
        await context.close();
      }
    }
  }
}

await browser.close();
await server.close();

const rows = shots.map((s) => `<figure><img src="${s.file}" loading="lazy"><figcaption>${s.file}</figcaption></figure>`).join('\n');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Site shots</title>
<style>body{background:#111;color:#ccc;font:13px system-ui;margin:20px}main{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
figure{margin:0;max-width:480px}img{max-width:100%;border:1px solid #333}</style><main>${rows}</main>`);

console.log(`look: ${shots.length} pictures in ${path.relative(process.cwd(), out) || out}`);
if (trouble.length) {
  console.log(`\npages that complained:\n${trouble.join('\n')}`);
  process.exitCode = 1;
}

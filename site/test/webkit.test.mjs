/**
 * The site in WebKit, the engine of every browser on an iPhone, as an iPhone opens it.
 *
 * The rest of the tests run in Chrome, and the site stopped opening in Safari on iOS while all of
 * them were green. One cause showed up here at once: a <source> inside the clip's <video> kept
 * WebKit's load event from ever firing, so the landing never finished loading, while Chrome
 * finished it in 60 ms. So every kind of page has to finish loading here, without an error.
 *
 * WebKit is Playwright's own build, fetched with `npx playwright-core install webkit` (CI does,
 * site.yml). Without it these tests are skipped locally; SITE_WEBKIT=required makes a missing
 * WebKit a failure instead, which is how CI runs them.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { webkit, devices } from 'playwright-core';
import { serveDist, samplePages, isOffline } from './harness.mjs';

let server, browser, why = '';
before(async () => {
  server = await serveDist();
  try {
    browser = await webkit.launch();
  } catch (e) {
    why = String(e.message).split('\n')[0];
    if (process.env.SITE_WEBKIT === 'required') throw e;
  }
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const IPHONE = devices['iPhone 15'];

test('every kind of page finishes loading on an iPhone, without an error', { timeout: 600_000 }, async (t) => {
  if (!browser) return t.skip(`no WebKit here (${why}); npx playwright-core install webkit`);
  const bad = [];
  for (const p of samplePages()) {
    const context = await browser.newContext(IPHONE);
    // the web only, as in the Chrome tests; d2mm:// is the browser's to refuse
    await context.route((url) => /^https?:/.test(url.href) && !url.href.startsWith(server.url), (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !isOffline(m.text()) && !/d2mm:/.test(m.text())) errors.push(m.text()); });
    page.on('crash', () => errors.push('the page crashed'));
    const t0 = Date.now();
    try {
      // the preset page sends itself to d2mm:// while loading, so it is held to "commit"
      await page.goto(server.url + p, { waitUntil: p === '/p/' ? 'commit' : 'load', timeout: 10_000 });
    } catch {
      bad.push(`${p}: not loaded after 10 s`);
    }
    await page.waitForTimeout(300);
    if (errors.length) bad.push(`${p}: ${errors.join('; ')}`);
    if (Date.now() - t0 > 8000) bad.push(`${p}: ${Date.now() - t0} ms to load`);
    await context.close();
  }
  assert.deepEqual(bad, []);
});

test('the landing on an iPhone runs no animation forever and paints no blur', async (t) => {
  if (!browser) return t.skip(`no WebKit here (${why})`);
  const context = await browser.newContext(IPHONE);
  const page = await context.newPage();
  await page.goto(`${server.url}/`, { waitUntil: 'load', timeout: 10_000 });
  for (let y = 0; y < 12000; y += 900) {
    await page.evaluate((top) => scrollTo(0, top), y);
    await page.waitForTimeout(40);
  }
  const heavy = await page.evaluate(() => {
    const out = [];
    for (const a of document.getAnimations()) {
      const timing = a.effect?.getTiming?.();
      if (timing && timing.iterations === Infinity && a.playState === 'running') {
        const el = a.effect.target;
        out.push(`runs forever: ${el?.className || el?.tagName} (${a.animationName || 'animation'})`);
      }
    }
    for (const el of document.querySelectorAll('*')) {
      const f = getComputedStyle(el).filter;
      const r = el.getBoundingClientRect();
      if (/blur\(/.test(f) && r.width * r.height > 200 * 200) out.push(`blurred: ${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  // the marquee is a plain transform, which a phone moves for free; everything else may not run
  assert.deepEqual(heavy.filter((x) => !/marquee/.test(x)), []);
  await context.close();
});

/* The download menus, opened by a finger on an iPhone and looked at twice: the moment the tap is
   handled, and once the entrance has finished. Safari on a real iPhone once showed the hero's menu
   past the screen's left edge now and then; the menu is placed before its first frame since. */
test('both download menus open inside an iPhone screen, at once and after the entrance', async (t) => {
  if (!browser) return t.skip(`no WebKit here (${why})`);
  const bad = [];
  for (const lang of ['', '/ru']) {
    const context = await browser.newContext(IPHONE);
    const page = await context.newPage();
    await page.goto(`${server.url}${lang}/`, { waitUntil: 'load', timeout: 10_000 });
    for (const where of ['.hero', '.final']) {
      const summary = page.locator(`${where} .dl summary`);
      await summary.evaluate((el) => scrollBy({ top: el.getBoundingClientRect().top - innerHeight * 0.4, behavior: 'instant' }));
      await page.waitForTimeout(700);
      // a click handled whole inside the page, then the menu read before anything is drawn
      const first = await summary.evaluate((el) => {
        el.click();
        const r = el.parentElement.querySelector('.dl-menu').getBoundingClientRect();
        const box = { left: r.left, right: r.right, vw: document.documentElement.clientWidth };
        el.parentElement.open = false;
        return box;
      });
      await summary.tap();
      await page.waitForTimeout(400);
      const later = await summary.evaluate((el) => {
        const r = el.parentElement.querySelector('.dl-menu').getBoundingClientRect();
        return { left: r.left, right: r.right, vw: document.documentElement.clientWidth, open: el.parentElement.open };
      });
      if (!later.open) bad.push(`${lang || 'en'} ${where}: a tap did not open it`);
      for (const [when, b] of [['at once', first], ['after the entrance', later]]) {
        if (b.left < 0 || b.right > b.vw) bad.push(`${lang || 'en'} ${where} ${when}: ${Math.round(b.left)}..${Math.round(b.right)} of ${b.vw}`);
      }
      await page.touchscreen.tap(4, 400);
    }
    await context.close();
  }
  assert.deepEqual(bad, []);
});

/**
 * One page of each kind, opened in a real browser at the widths people read it at: the page has
 * to load without an error, without a refused script or style, without a missing file, and
 * without anything sticking out past the edge of the screen.
 *
 * The widths are the ones layouts break at: a 320 px phone (the narrowest still sold), a common
 * 390 px one, a tablet held upright, a small laptop, and a desktop.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveDist, launch, openPage, samplePages, findOverflow, findCovered, isOffline, snap } from './harness.mjs';

let server, browser;
before(async () => {
  server = await serveDist();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const WIDTHS = { mobile: [320, 390], desktop: [768, 1024, 1440] };

/** A few pages at a time: each is a fresh browser context, and they do not share anything. */
async function eachPage(list, fn, width = 4) {
  const queue = [...list];
  const fails = [];
  await Promise.all(Array.from({ length: width }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try { await fn(p); } catch (e) { fails.push(`${p}: ${e.message}`); }
    }
  }));
  return fails;
}

for (const screen of ['mobile', 'desktop']) {
  test(`every kind of page loads cleanly and fits the screen (${screen})`, { timeout: 600_000 }, async () => {
    const bad = await eachPage(samplePages(), async (p) => {
      const { context, page, problems } = await openPage(browser, server.url, screen);
      try {
        const res = await page.goto(server.url + p, { waitUntil: 'load' });
        if (res.status() !== 200) throw new Error(`status ${res.status()}`);
        await page.waitForTimeout(150);
        const own = problems.filter((l) => !isOffline(l));
        if (own.length) throw new Error(own.join('; '));
        for (const w of WIDTHS[screen]) {
          await page.setViewportSize({ width: w, height: screen === 'mobile' ? 760 : 900 });
          await page.waitForTimeout(60);
          const over = await findOverflow(page);
          if (over.length) {
            await snap(page, `overflow-${screen}-${w}-${p}`);
            throw new Error(`at ${w}px: ${over.join('; ')}`);
          }
        }
      } finally {
        await context.close();
      }
    });
    assert.deepEqual(bad, []);
  });
}

test('the header and footer links can all be pressed on a phone', async () => {
  const bad = await eachPage(['/', '/ru/', '/docs/', '/ru/heroes/'], async (p) => {
    const { context, page } = await openPage(browser, server.url, 'mobile');
    try {
      for (const w of [320, 390]) {
        await page.setViewportSize({ width: w, height: 760 });
        await page.goto(server.url + p, { waitUntil: 'load' });
        // the header's own links, as the page opens
        const head = await findCovered(page, '.topbar a');
        // the footer's, scrolled to: a link cut off by its row, or drawn under something, fails
        await page.locator('.foot-links').scrollIntoViewIfNeeded();
        const covered = [];
        for (const link of await page.locator('.foot a').all()) {
          await link.scrollIntoViewIfNeeded();
          const box = await link.boundingBox();
          if (!box || box.x < 0 || box.x + box.width > w + 1) covered.push(`"${await link.textContent()}" is off the screen`);
        }
        const foot = [...covered, ...(await findCovered(page, '.foot-links a'))];
        if (head.length || foot.length) {
          await snap(page, `links-${w}-${p}`);
          throw new Error(`at ${w}px: ${[...head, ...foot].join('; ')}`);
        }
      }
    } finally {
      await context.close();
    }
  });
  assert.deepEqual(bad, []);
});

test('the header leaves a phone most of its screen', async () => {
  // It is sticky, so whatever it takes it takes on every screen of every page. It once wrapped
  // to three rows and kept 155 px of an 844 px phone for itself.
  for (const p of ['/', '/ru/']) {
    const { context, page } = await openPage(browser, server.url, 'mobile');
    for (const w of [320, 390]) {
      await page.setViewportSize({ width: w, height: 760 });
      await page.goto(server.url + p, { waitUntil: 'load' });
      const h = await page.locator('.topbar').evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(h <= 110, `${p} at ${w}px: the header is ${Math.round(h)} px tall`);
    }
    await context.close();
  }
});

test('the skip link appears on the first Tab and lands on the content', async () => {
  const { context, page } = await openPage(browser, server.url, 'desktop');
  await page.goto(`${server.url}/docs/`, { waitUntil: 'load' });
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip');
  assert.equal(await skip.evaluate((el) => el === document.activeElement), true);
  const box = await skip.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0, 'the skip link is on screen when focused');
  await page.keyboard.press('Enter');
  assert.match(page.url(), /#main$/);
  await context.close();
});

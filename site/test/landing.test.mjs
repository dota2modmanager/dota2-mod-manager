/**
 * The landing's moving parts, pressed the way a visitor presses them, on a desktop and on a phone,
 * in both languages.
 *
 * Motion stays on unless a test says otherwise. The sections rise in on a scroll-driven animation,
 * and an element with a running animation is a layer of its own: that is what put the cards under
 * the download menu at the foot of the page, and with reduced motion the bug was not there at all.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveDist, launch, openPage, findCovered, snap } from './harness.mjs';

let server, browser;
before(async () => {
  server = await serveDist();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(screen, lang = '', motion = 'no-preference') {
  const { context, page, problems } = await openPage(browser, server.url, screen, { motion });
  await page.goto(`${server.url}${lang}/`, { waitUntil: 'load' });
  return { context, page, problems };
}

/** Put an element a third of the way down the screen, with no smooth scroll to wait out. */
async function bring(locator) {
  await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    scrollBy({ top: r.top - innerHeight * 0.3, behavior: 'instant' });
  });
}

/** Wait for a smooth scroll to finish: the position has stopped changing. */
async function settled(page) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => scrollY);
    if (y === last) return y;
    last = y;
    await page.waitForTimeout(80);
  }
  return last;
}

const press = (screen, locator) => (screen === 'mobile' ? locator.tap() : locator.click());

for (const screen of ['desktop', 'mobile']) {
  for (const lang of ['', '/ru']) {
    const name = `${screen}, ${lang ? 'ru' : 'en'}`;

    test(`both download menus open whole, on top of everything and on the screen (${name})`, async () => {
      const { context, page } = await open(screen, lang);
      try {
        for (const where of ['.hero', '.final']) {
          const dl = page.locator(`${where} .dl`);
          const summary = dl.locator('summary');
          await bring(summary);
          await press(screen, summary);
          await page.waitForTimeout(250);
          assert.equal(await dl.evaluate((d) => d.open), true, `${where}: the menu did not open`);

          const covered = await findCovered(page, `${where} .dl[open] .dl-item, ${where} .dl[open] .dl-all`);
          const box = await dl.locator('.dl-menu').boundingBox();
          const vw = await page.evaluate(() => document.documentElement.clientWidth);
          const off = box.x < 0 || box.x + box.width > vw ? [`the menu spans ${Math.round(box.x)}..${Math.round(box.x + box.width)} of ${vw}`] : [];
          if (covered.length || off.length) {
            await snap(page, `download-${where.slice(1)}-${screen}-${lang ? 'ru' : 'en'}`);
            assert.fail(`${where}: ${[...covered, ...off].join('; ')}`);
          }

          // Escape closes it and hands the focus back to the button
          await page.keyboard.press('Escape');
          assert.equal(await dl.evaluate((d) => d.open), false, `${where}: Escape left it open`);
          assert.equal(await summary.evaluate((s) => s === document.activeElement), true, `${where}: focus did not come back`);

          // so does a press anywhere else
          await press(screen, summary);
          await press(screen, page.locator(where === '.hero' ? '.hero h1' : '.final-box h2'));
          assert.equal(await dl.evaluate((d) => d.open), false, `${where}: a press elsewhere left it open`);
        }
      } finally {
        await context.close();
      }
    });

    test(`the header's Download lands on the button, clear of the header (${name})`, async () => {
      const { context, page } = await open(screen, lang);
      try {
        await press(screen, page.locator('.topbar .cta'));
        await settled(page);
        assert.match(page.url(), /#download$/);
        const head = await page.locator('.topbar').boundingBox();
        const btn = await page.locator('#download > summary').boundingBox();
        const vh = await page.evaluate(() => innerHeight);
        if (btn.y < head.y + head.height || btn.y + btn.height > vh) {
          await snap(page, `cta-${screen}-${lang ? 'ru' : 'en'}`);
          assert.fail(`the button is at ${Math.round(btn.y)}..${Math.round(btn.y + btn.height)}, the header ends at ${Math.round(head.y + head.height)}`);
        }
      } finally {
        await context.close();
      }
    });
  }

  test(`the download menu marks the visitor's own file, and only on a computer (${screen})`, async () => {
    const { context, page } = await open(screen);
    const ua = await page.evaluate(() => navigator.userAgent);
    const marked = await page.locator('.hero .dl-item.match').evaluateAll((els) => els.map((e) => e.dataset.os));
    if (screen === 'mobile') assert.deepEqual(marked, [], 'an Android phone is neither Windows nor Linux');
    // the installer, not the portable build: one answer, not two
    else if (/Windows/.test(ua)) assert.deepEqual(marked, ['win']);
    else if (/Linux/.test(ua)) assert.deepEqual(marked, ['linux']);
    await context.close();
  });

  test(`the clip keeps its own shape and can always be started (${screen})`, async () => {
    for (const motion of ['no-preference', 'reduce']) {
      const { context, page } = await open(screen, '', motion);
      const film = page.locator('#film');
      await bring(film);
      await page.waitForTimeout(400);
      const box = await film.boundingBox();
      // the box the poster sits in is the clip's own 880 x 556, not a tall frame around it
      assert.ok(Math.abs(box.height / box.width - 556 / 880) < 0.02, `the clip is ${Math.round(box.width)} x ${Math.round(box.height)}`);

      const play = page.locator('#filmPlay');
      const playing = await film.evaluate((v) => !v.paused);
      if (screen === 'mobile' || motion === 'reduce') {
        assert.equal(await play.isVisible(), true, `${motion}: no play button`);
        // the label on one line: a button that breaks in two reads as two buttons
        const lines = await play.evaluate((b) => {
          const tops = new Set();
          for (const n of b.childNodes) {
            if (n.nodeType !== Node.TEXT_NODE || !n.textContent.trim()) continue;
            const r = document.createRange();
            r.selectNodeContents(n);
            for (const rect of r.getClientRects()) tops.add(Math.round(rect.top));
          }
          return tops.size;
        });
        assert.equal(lines, 1, 'the play button breaks onto two lines');
        await press(screen, play);
        assert.equal(await play.isVisible(), false);
        assert.equal(await film.evaluate((v) => v.controls), true);
      } else {
        // it starts on its own, or offers the button when the browser refuses
        assert.ok(playing || (await play.isVisible()), 'neither playing nor offering to play');
      }
      await context.close();
    }
  });
}

test('the screenshots switch by click and by keyboard', async () => {
  const { context, page } = await open('desktop');
  const visible = () => page.locator('.tour-panel').evaluateAll((ps) => ps.map((p) => !p.hidden));
  const tabs = page.locator('.tour-tab');
  await tabs.nth(1).click();
  assert.deepEqual(await visible(), [false, true, false]);
  await page.keyboard.press('End');
  assert.deepEqual(await visible(), [false, false, true]);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await visible(), [true, false, false], 'ArrowRight from the last wraps to the first');
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await visible(), [false, false, true]);
  assert.equal(await tabs.nth(2).evaluate((t) => t === document.activeElement && t.tabIndex === 0), true);
  await context.close();
});

test('the pak panel: switching off clears the clash, moving a mod up changes the winner', async () => {
  for (const screen of ['desktop', 'mobile']) {
    const { context, page } = await open(screen);
    const verdict = page.locator('#standVerdict');
    const slots = () => page.locator('#standSlots li').allTextContents();
    await bring(page.locator('#stand'));

    assert.match(await verdict.textContent(), /Gopo Pudge/);
    const butcher = page.locator('.stand-row[data-id="butcher"]');
    await press(screen, butcher.locator('.stand-sw'));
    assert.equal(await page.locator('.stand-row[data-id="butcher"]').evaluate((r) => r.classList.contains('off')), true);
    assert.equal((await slots()).length, 4);
    assert.equal(await verdict.isHidden(), true, 'no clash left, so no verdict');

    await press(screen, page.locator('.stand-row[data-id="butcher"] .stand-sw'));
    await page.locator('.stand-row[data-id="butcher"] .stand-grip').focus();
    await page.keyboard.press('ArrowUp');
    assert.match((await slots())[0], /pak10\s*Pudge Butcher Arcana/);
    assert.match(await verdict.textContent(), /Pudge Butcher Arcana/);
    assert.equal(await page.locator('.stand-row[data-id="butcher"] .stand-grip').evaluate((g) => g === document.activeElement), true, 'the grip keeps the focus');
    await context.close();
  }
});

test('a question opens and closes', async () => {
  const { context, page } = await open('mobile');
  const faq = page.locator('.faq').first();
  await faq.locator('summary').tap();
  assert.equal(await faq.evaluate((d) => d.open), true);
  await faq.locator('summary').tap();
  assert.equal(await faq.evaluate((d) => d.open), false);
  await context.close();
});

test('the eight mascots hide in the margins, and only where there are margins', async () => {
  const { context, page } = await open('desktop');
  const spots = await page.locator('.hunt-hero').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  assert.equal(spots.length, 8);
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  const gutter = (vw - 1080) / 2;
  for (const r of spots) assert.ok(r.right <= gutter + 20 || r.left >= vw - gutter - 20, `a mascot sits over the column at x ${Math.round(r.left)}`);

  // finding one gives the page its colours and brings up the tally
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary'));
  await page.locator('.hunt-hero').nth(1).click({ force: true });
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#hunt-score').isVisible(), true);
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary'));
  assert.notEqual(after, before);
  await context.close();

  for (const [screen, motion] of [['mobile', 'no-preference'], ['desktop', 'reduce']]) {
    const c = await open(screen, '', motion);
    assert.equal(await c.page.locator('.hunt-hero').count(), 0, `${screen}, ${motion}: nothing to hunt`);
    await c.context.close();
  }
});

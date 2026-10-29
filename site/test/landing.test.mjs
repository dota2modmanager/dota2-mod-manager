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
          // on an empty spot by the screen's edge: the menu may have opened over anything else
          const vh = await page.evaluate(() => innerHeight);
          if (screen === 'mobile') await page.touchscreen.tap(4, vh / 2); else await page.mouse.click(4, vh / 2);
          assert.equal(await dl.evaluate((d) => d.open), false, `${where}: a press elsewhere left it open`);
        }
      } finally {
        await context.close();
      }
    });

    /* On an iPhone the menu now and then showed past the screen's edge, though the test above, which
       looks a moment after the press, never saw it there. So this one looks at once: the menu has
       to be in its place by the time the press has been handled, before any frame is drawn. */
    test(`a download menu is on the screen from the moment it opens (${name})`, async () => {
      const { context, page } = await open(screen, lang);
      try {
        for (const where of ['.hero', '.final']) {
          await bring(page.locator(`${where} .dl summary`));
          const at = await page.evaluate((sel) => {
            const dl = document.querySelector(sel);
            dl.querySelector('summary').click();
            const r = dl.querySelector('.dl-menu').getBoundingClientRect();
            const out = { open: dl.open, left: Math.round(r.left), right: Math.round(r.right), vw: document.documentElement.clientWidth };
            dl.open = false;
            return out;
          }, `${where} .dl`);
          assert.equal(at.open, true, `${where}: the press did not open it`);
          assert.ok(at.left >= 0 && at.right <= at.vw, `${where}: the menu opened at ${at.left}..${at.right} of ${at.vw}`);
        }
      } finally {
        await context.close();
      }
    });

    test(`the header's Download lands on the button, clear of the header (${name})`, async () => {
      const { context, page } = await open(screen, lang);
      try {
        // a phone cannot run the app: its header offers the catalog instead, and the note under
        // the download says where the app does run
        if (screen === 'mobile') {
          assert.equal(await page.locator('.topbar .cta-download').isVisible(), false);
          assert.match(await page.locator('.topbar .cta-catalog').getAttribute('href'), /\/catalog\/$/);
          assert.equal(await page.locator('.final .phone-note').isVisible(), true);
          assert.equal(await page.locator('.final .phone-note [data-share]').isVisible(), true);
          return;
        }
        assert.equal(await page.locator('.topbar .cta-catalog').isVisible(), false);
        assert.equal(await page.locator('.final .phone-note').isVisible(), false, 'a computer is told to open the page on a computer');
        await press(screen, page.locator('.topbar .cta-download'));
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
      // the clip is the last of the app's tabs
      await bring(page.locator('#show'));
      await press(screen, page.locator('.show-tab').last());
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

test('on a phone each row of "by hand or with the app" names itself across the whole card', async () => {
  for (const lang of ['', '/ru']) {
    const { context, page } = await open('mobile', lang);
    try {
      const narrow = await page.$$eval('.compare tbody tr', (rows) => rows.flatMap((tr) => {
        const th = tr.querySelector('th');
        const room = tr.clientWidth - parseFloat(getComputedStyle(tr).paddingLeft) - parseFloat(getComputedStyle(tr).paddingRight);
        // the desktop's 26% column once squeezed "Two mods with the same file" into three lines
        return th.getBoundingClientRect().width < room - 1 ? [`${th.textContent.trim()}: ${Math.round(th.getBoundingClientRect().width)} of ${Math.round(room)} px`] : [];
      }));
      assert.deepEqual(narrow, [], lang || 'en');
    } finally {
      await context.close();
    }
  }
});

test('the tabs of the app switch by click and by keyboard', async () => {
  const { context, page } = await open('desktop');
  const visible = () => page.locator('.show-panel').evaluateAll((ps) => ps.map((p) => !p.hidden));
  const tabs = page.locator('.show-tab');
  await tabs.nth(1).click();
  assert.deepEqual(await visible(), [false, true, false, false]);
  await page.keyboard.press('End');
  assert.deepEqual(await visible(), [false, false, false, true]);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await visible(), [true, false, false, false], 'ArrowRight from the last wraps to the first');
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await visible(), [false, false, false, true]);
  assert.equal(await tabs.nth(3).evaluate((t) => t === document.activeElement && t.tabIndex === 0), true);
  // leaving the clip's tab stops the clip
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#film').evaluate((v) => v.paused), true);
  await context.close();
});

test('the search on the landing answers like the header: heroes, authors and mods, each to its page', async () => {
  for (const screen of ['desktop', 'mobile']) {
    const { context, page } = await open(screen);
    const input = page.locator('#finder-q');
    await bring(input);
    const ask = async (q) => {
      await input.fill(q);
      await page.waitForFunction((x) => document.getElementById('finderResults')?.dataset.q === x, q);
    };
    // the hero first, then their mods
    await ask('pudge');
    const hrefs = await page.locator('#finderResults .finder-row').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    assert.equal(hrefs[0], '/heroes/pudge/');
    const mods = hrefs.filter((h) => h.startsWith('/mods/'));
    assert.ok(mods.length > 0 && mods.length <= 6);
    for (const t of await page.locator('#finderResults .finder-row[data-kind="mod"]').allTextContents()) assert.match(t.toLowerCase(), /pudge|пудж/);
    // a nickname finds the hero, as in the header
    await ask('кристалка');
    assert.equal(await page.locator('#finderResults a[href="/heroes/crystal-maiden/"]').count(), 1);
    // many mods: the rest are the catalog's own search
    await ask('arcana');
    assert.match(await page.locator('#finderResults .finder-all').getAttribute('href'), /^\/catalog\/\?q=arcana$/);
    // and a mod leads to its page
    await ask('pudge');
    await press(screen, page.locator('#finderResults .finder-row[data-kind="mod"]').first());
    await page.waitForURL(/\/mods\/[a-z0-9-]+\/$/);
    assert.match(await page.locator('h1').textContent(), /pudge/i);
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

/** The order the seven have to be found in (Hunt.astro HEROES, hunt-notes.ts LINES). */
const ORDER = ['meepo', 'invoker', 'bh', 'ursa', 'storm', 'brew', 'fura'];
async function findSeven(page) {
  for (const id of ORDER) {
    await page.locator(`.hunt-hero[data-hero="${id}"]`).click({ force: true });
    await page.waitForTimeout(260);
  }
}

test('seven mascots hide in the margins and Axe hangs in the middle, never over the page', async () => {
  const { context, page } = await open('desktop');
  const spots = await page.locator('.hunt-hero:not(.cocoon)').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  assert.equal(spots.length, 7);
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  const gutter = (vw - 1200) / 2;
  for (const r of spots) assert.ok(r.right <= gutter + 20 || r.left >= vw - gutter - 20, `a mascot sits over the column at x ${Math.round(r.left)}`);
  const cocoon = await page.locator('.hunt-hero.cocoon').evaluate((c) => {
    const r = c.getBoundingClientRect();
    const hit = [...document.querySelectorAll('section > .wrap')].some((w) => {
      const b = w.getBoundingClientRect();
      return b.top < r.bottom && b.bottom > r.top;
    });
    // where it hangs, not where its sway has carried it this instant
    return { mid: parseFloat(c.style.left) + c.offsetWidth / 2, hit, axe: c.dataset.hero };
  });
  assert.equal(cocoon.axe, 'axe');
  assert.ok(Math.abs(cocoon.mid - vw / 2) < 4, `the cocoon hangs at x ${Math.round(cocoon.mid)}, not in the middle`);
  assert.equal(cocoon.hit, false, 'the cocoon hangs over a section');

  // the first in order gives the page its colours and brings up the tally
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary'));
  await page.locator('.hunt-hero[data-hero="meepo"]').click({ force: true });
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

test('out of turn, a hero screams and everyone found goes back; Axe only whispers until the seven are in', async () => {
  const { context, page } = await open('desktop');
  await page.locator('.hunt-hero.cocoon').click({ force: true });
  await page.locator('.hunt-whisper').waitFor({ timeout: 2000 });
  await page.locator('.hunt-hero[data-hero="meepo"]').click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('.hunt-hero[data-hero="bh"]').click({ force: true });
  await page.locator('.hunt-scream').waitFor({ timeout: 2000 });
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.hunt-scream').count(), 0, 'the scream stayed on screen');
  assert.equal(await page.locator('.hunt-hero:not(.cocoon)').count(), 7, 'the one found before did not go back');
  assert.equal(await page.locator('#hunt-score').isHidden(), true);
  await context.close();
});

test('the order is written across the site while Halloween is in season, a line to a page', async () => {
  for (const [path, lines] of [['/', ['I.', 'VIII.']], ['/catalog/', ['II.']], ['/changes/', ['V.']], ['/ru/docs/', ['IV.']]]) {
    const { context, page } = await openPage(browser, server.url, 'desktop');
    await page.addInitScript(() => localStorage.setItem('mm-look', 'halloween'));
    await page.goto(`${server.url}${path}`, { waitUntil: 'load' });
    const got = await page.locator('.hunt-note b').allTextContents();
    assert.deepEqual(got, lines, path);
    await context.close();
  }
  const { context, page } = await openPage(browser, server.url, 'desktop');
  await page.addInitScript(() => localStorage.setItem('mm-look', 'rainbow'));
  await page.goto(`${server.url}/`, { waitUntil: 'load' });
  assert.equal(await page.locator('.hunt-note').count(), 0, 'the notes are out of season');
  await context.close();
});

/** Chase the one that runs (src/scripts/chase.ts) the way a hand would, until it is caught. */
async function runDown(page, limit = 200_000) {
  const t0 = Date.now();
  let lastClick = 0;
  while (Date.now() - t0 < limit) {
    const r = await page.evaluate(() => {
      const e = document.querySelector('.chase-runner:not(.chase-decoy)');
      if (!e || document.querySelector('.chase.caught')) return null;
      const b = e.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    if (!r) return Date.now() - t0;
    // straight onto it, however long a step takes: on a slow CI runner a hand that moved a fixed
    // distance per step never got near, and the chase never ended (2026-10-20)
    await page.mouse.move(r.x, r.y);
    if (Date.now() - lastClick > 280) {
      lastClick = Date.now();
      await page.mouse.down();
      await page.mouse.up();
    }
    await page.waitForTimeout(12);
  }
  return null;
}

/* The chase waits for an app release that takes its key (Landing.astro, data-last), and mm-chase
   lets it run before then; the tests below that need it turn it on that way. The pumpkin's worker
   (tools/pumpkin-worker) is stood in for, and says what it was asked. */
const KEY = 'K7QX-M2PA-9HRT-WZ4N';
const chasing = async () => {
  const { context, page } = await openPage(browser, server.url, 'desktop');
  const asked = [];
  await context.route('https://pumpkin.dota2modmanager.com/**', async (route) => {
    const url = new URL(route.request().url());
    asked.push({ path: url.pathname, body: route.request().postData() });
    const json = url.pathname === '/ticket' ? { ticket: 'the-ticket' } : { key: KEY };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(json) });
  });
  await page.addInitScript(() => { localStorage.setItem('mm-chase', '1'); localStorage.setItem('mm-look', 'halloween'); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.url}/`, { waitUntil: 'load' });
  return { context, page, asked };
};

test('until the build says Axe runs, he is found like the other seven', async () => {
  const { context, page } = await open('desktop');
  const runs = await page.evaluate(() => document.getElementById('hunt').dataset.last !== undefined);
  await findSeven(page);
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.hunt-hero.cocoon').count(), 0, 'the cocoon did not tear when the seven were in');
  assert.equal(await page.locator('.hunt-hero.runner').count(), runs ? 1 : 0);
  if (!runs) {
    await page.locator('.hunt-hero[data-hero="axe"]').click({ force: true });
    const done = page.locator('#hunt-done');
    await done.waitFor();
    assert.match(await done.textContent(), /8\/8/);
    // the reward, in whichever look the day has (scripts/look.ts)
    assert.equal(await page.evaluate(() => ['rainbow', 'halloween'].some((l) => document.documentElement.classList.contains(l))), true);
    await done.locator('.hunt-close').click();
    assert.equal(await done.isHidden(), true);
  }
  await context.close();
});

test('Axe runs, and only a long chase catches him: the site turns, and a key of ones own', { timeout: 300_000 }, async () => {
  const { context, page, asked } = await chasing();
  await findSeven(page);
  await page.waitForTimeout(1200);
  const runner = page.locator('.hunt-hero.runner');
  assert.equal(await runner.count(), 1, 'Axe is not the one that runs');

  // loose, he slips away from the hand a few times before a click lands
  await runner.scrollIntoViewIfNeeded();
  const at = await runner.boundingBox();
  await page.mouse.move(at.x + 27, at.y - 200);
  await page.mouse.move(at.x + 27, at.y + 27, { steps: 6 });
  await page.waitForTimeout(450);
  const moved = await runner.boundingBox();
  assert.ok(Math.hypot(moved.x - at.x, moved.y - at.y) > 100, `he waited to be clicked: ${Math.round(at.x)},${Math.round(at.y)} -> ${Math.round(moved.x)},${Math.round(moved.y)}`);
  for (let i = 0; i < 8 && !(await page.locator('.chase').count()); i++) {
    await runner.scrollIntoViewIfNeeded();
    const b = await runner.boundingBox();
    await page.mouse.click(b.x + 27, b.y + 27);
    await page.waitForTimeout(350);
  }
  const night = page.locator('.chase');
  await night.waitFor();
  assert.equal((await page.locator('.chase-title').textContent()).trim(), 'CATCHME');
  await page.waitForTimeout(1000);
  // the type fits the screen it shakes on
  const title = await page.locator('.chase-title .line').evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().toJSON()));
  for (const l of title) assert.ok(l.left >= 0 && l.right <= 1440, `the line runs ${Math.round(l.left)}..${Math.round(l.right)}`);

  // Escape gives up: the night lifts and he is back in the middle, ready to go again
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1900);
  assert.equal(await night.count(), 0, 'Escape left the chase on screen');
  assert.equal(await runner.count(), 1, 'he did not go back to the middle');
  await runner.scrollIntoViewIfNeeded();
  const b = await runner.boundingBox();
  await page.mouse.click(b.x + 27, b.y + 27);
  await night.waitFor();
  await page.waitForTimeout(800);

  // and he is not caught on the first try: a click on a fresh one only makes him dodge
  const took = await runDown(page);
  assert.ok(took !== null, 'nobody could catch him in two hundred seconds');
  assert.ok(took > 8000, `caught after ${took} ms, which is no chase at all`);

  const prize = page.locator('.hunt-key');
  await prize.waitFor({ timeout: 4000 });
  await page.locator('.hunt-key-code:not(.waiting)').waitFor({ timeout: 4000 });
  assert.equal((await prize.locator('.hunt-key-code').textContent()).trim(), KEY);
  // a ticket at the start of the chase, spent on the key once he was caught
  assert.ok(asked.some((a) => a.path === '/ticket'), 'no ticket was asked for');
  assert.ok(asked.some((a) => a.path === '/claim' && JSON.parse(a.body).ticket === 'the-ticket'), 'the key was not claimed with the ticket');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('halloween')), true, 'the page did not put on the look of the day');
  // the footer offers the key again, for whoever closed it before writing it down
  await prize.locator('.hunt-close').click();
  // it fades for 260 ms before it goes (chase.ts, shut); a fixed 300 ms wait lost that race on a busy runner
  await prize.waitFor({ state: 'detached', timeout: 3000 });
  assert.equal(await prize.count(), 0);
  const again = page.locator('#keyAgain');
  await again.scrollIntoViewIfNeeded();
  assert.notEqual((await page.locator('#rainbowSwitch').textContent()).trim(), '', 'the rainbow switch has no words');
  await again.click();
  assert.equal((await page.locator('.hunt-key-code').textContent()).trim(), KEY);
  await context.close();
});

test('last year\'s rainbow does not skip this year\'s hunt, and a catcher gets the key back instead', async () => {
  for (const [flags, heroes] of [[{ 'mm-chase': '1', 'mm-rainbow': '1', 'mm-caught': '1' }, 8], [{ 'mm-chase': '1', 'mm-rainbow': '1', 'mm-bled': '1', 'mm-key': KEY }, 0]]) {
    const { context, page } = await openPage(browser, server.url, 'desktop');
    await page.addInitScript((f) => { for (const [k, v] of Object.entries(f)) localStorage.setItem(k, v); }, flags);
    await page.goto(`${server.url}/`, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.hunt-hero').count(), heroes, JSON.stringify(flags));
    if (!heroes) assert.equal(await page.locator('#keyAgain').count(), 1, 'a catcher is not offered the key again');
    await context.close();
  }
});

test('the rainbow follows the visitor, and the footer switch turns it off', async () => {
  const { context, page } = await openPage(browser, server.url, 'desktop');
  await page.goto(`${server.url}/`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('mm-rainbow', '1'); localStorage.setItem('mm-look', 'rainbow'); });
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('rainbow')), true);
  // the colour every surface is drawn from is moving, not just the title
  const a = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary'));
  await page.waitForTimeout(1200);
  const b = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary'));
  assert.notEqual(a, b, 'the page is not cycling through the palettes');

  // it follows the visitor to the next page, and the footer can turn it off
  await page.goto(`${server.url}/docs/`, { waitUntil: 'load' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('rainbow')), true);
  const sw = page.locator('#rainbowSwitch');
  await sw.scrollIntoViewIfNeeded();
  await sw.click();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('rainbow')), false);
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('rainbow')), false);
  await context.close();
});

test('Halloween dresses the page: webs, blood, spiders that come down with the scroll, lanterns, and the switch takes it all off', async () => {
  const { context, page } = await openPage(browser, server.url, 'desktop');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${server.url}/`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('mm-rainbow', '1'); localStorage.setItem('mm-look', 'halloween'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  const count = (sel) => page.locator(sel).count();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('halloween')), true);
  assert.equal(await count('.hw-web'), 4, 'a web in each corner');
  assert.ok((await count('.topbar .hw-blood i')) >= 6, 'blood under the header');
  assert.equal(await count('.hw-hanger'), 2, 'two spiders on threads');
  assert.equal(await count('.foot .hw-garland span'), 8, 'lanterns over the footer');

  // the spiders come down as the page goes, each to its own depth: the first no further than the
  // middle of the screen, the second all the way to the bottom of it once the page is read through
  const read = () => page.evaluate(() => [...document.querySelectorAll('.hw-hanger')].map((h) => h.getBoundingClientRect().bottom));
  const before = await read();
  for (const y of [800, 1600, 2400, 3200]) { await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(120); }
  await page.waitForTimeout(300);
  const after = await read();
  assert.ok(after.every((v, i) => v > before[i] + 60), `the spiders did not come down: ${before} -> ${after}`);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  const bottom = await read();
  assert.ok(bottom[0] < 900 * 0.6, `the first spider went past the middle: ${bottom[0]}`);
  assert.ok(bottom[1] > 900 * 0.8, `the second spider stopped short of the bottom: ${bottom[1]}`);
  // the webs are left hanging about the page, and none of them moves with the spiders
  const webs = await page.evaluate(() => [...document.querySelectorAll('.hw-strung')].map((w) => Math.round(parseFloat(w.style.top))));
  assert.ok(webs.length >= 3 && new Set(webs).size === webs.length, `webs not scattered: ${webs}`);
  assert.equal(await count('.hw-woven'), 0, 'a web still follows a spider');
  assert.ok((await count('.hw-garland.strung')) >= 1, 'no lanterns strung between the sections');
  // all of it lets the pointer through
  const blocking = await page.evaluate(() => [...document.querySelectorAll('.hw-web, .hw-blood, .hw-hanger, .hw-thread, .hw-strung, .hw-garland')].filter((e) => getComputedStyle(e).pointerEvents !== 'none').length);
  assert.equal(blocking, 0, 'part of the dressing catches clicks');

  // the footer speaks of Halloween, and turning it off takes the dressing down
  const sw = page.locator('#rainbowSwitch');
  await sw.scrollIntoViewIfNeeded();
  assert.match(await sw.textContent(), /Halloween/);
  await sw.click();
  assert.equal(await count('.hw-web'), 0, 'the webs stayed after the switch');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('halloween')), false);
  await context.close();

  // a phone wears it holding still: nothing runs across a screen that has no pointer
  const phone = await openPage(browser, server.url, 'mobile');
  await phone.page.goto(`${server.url}/`, { waitUntil: 'load' });
  await phone.page.evaluate(() => { localStorage.setItem('mm-rainbow', '1'); localStorage.setItem('mm-look', 'halloween'); });
  await phone.page.reload({ waitUntil: 'load' });
  await phone.page.waitForTimeout(500);
  const moving = await phone.page.evaluate(() => document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations === Infinity && a.playState === 'running').map((a) => a.effect.target?.className?.baseVal ?? a.effect.target?.className));
  assert.deepEqual(moving.filter((c) => /hw/.test(String(c))), [], 'the dressing loops on a phone');
  assert.equal(await phone.page.locator('.hw-runner').count(), 0);
  await phone.context.close();
});

test('a new round of the night forgets what the last one left, once, before the first paint', async () => {
  const { context, page } = await openPage(browser, server.url, 'desktop');
  // somebody from the round before: rewarded, Axe caught, a key, the mask, and no mark of this round
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.removeItem('mm-night');
    for (const k of ['mm-rainbow', 'mm-bled', 'mm-key', 'mm-heart']) localStorage.setItem(k, '1');
    localStorage.setItem('mm-sound', '1');
  });
  await page.goto(`${server.url}/`, { waitUntil: 'load' });
  const left = await page.evaluate(() => ({
    kept: ['mm-rainbow', 'mm-bled', 'mm-key', 'mm-heart'].filter((k) => localStorage.getItem(k) !== null),
    sound: localStorage.getItem('mm-sound'),
    worn: document.documentElement.classList.contains('rainbow') || document.documentElement.classList.contains('halloween'),
  }));
  assert.deepEqual(left.kept, []);
  assert.equal(left.sound, '1', 'a choice that is not part of the night stays');
  assert.equal(left.worn, false, 'the page wore the forgotten reward');
  // earned again in this round, it stays
  await page.evaluate(() => localStorage.setItem('mm-rainbow', '1'));
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.evaluate(() => localStorage.getItem('mm-rainbow')), '1');
  await context.close();
});

test('in season the page itself turns: hands on the cards, eyes that whisper the way on, and a mask on the lost page', { timeout: 60_000 }, async () => {
  // for everybody while Halloween is on, earned or not: no mm-rainbow here
  const { context, page } = await openPage(browser, server.url, 'desktop');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${server.url}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('mm-look', 'halloween'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.dr-grip').count()) >= 1, 'no hand holds on to a card');
  assert.ok((await page.locator('.dr-word').count()) >= 1, 'no word is possessed');
  // the first thing the eyes say is the way into the app's half of the hunt
  const eyes = page.locator('.dr-eyes').first();
  await eyes.scrollIntoViewIfNeeded();
  await eyes.click();
  assert.match(await page.locator('.dr-whisper').textContent(), /twenty/);
  await context.close();

  // the lost page: his mask on a thread; pressed, a phone rings, and picked up it shows the mod
  const lost = await openPage(browser, server.url, 'desktop');
  await lost.page.goto(`${server.url}/404.html`, { waitUntil: 'load' });
  await lost.page.evaluate(() => localStorage.setItem('mm-look', 'halloween'));
  await lost.page.reload({ waitUntil: 'load' });
  await lost.page.locator('.hs-mask').click({ force: true }); // it swings on its thread and is never still
  await lost.page.locator('.hs-pick').click();
  await lost.page.locator('.hs.on .hs-title').waitFor({ timeout: 20_000 });
  assert.match(await lost.page.locator('.hs-card').textContent(), /Necrophos[\s\S]*not in the catalog/);
  assert.equal(await lost.page.evaluate(() => localStorage.getItem('mm-heart')), '1');
  // whoever found it keeps the mask, so the footer has it
  await lost.page.locator('.hs-close').click();
  assert.equal(await lost.page.locator('.foot-legal .dr-trophy').count(), 1, 'the mask is not in the footer');
  // and pressed there it shows the mod again, without the call
  await lost.page.waitForTimeout(500);
  await lost.page.locator('.foot-legal .dr-trophy').click();
  await lost.page.locator('.hs.on .hs-title').waitFor({ timeout: 5_000 });
  await lost.context.close();
});

test('the note says it once and leaves by itself', async () => {
  // a fresh page on somebody else's link, the way it arrives from a chat
  const { context, page } = await openPage(browser, server.url, 'desktop');
  await page.goto(`${server.url}/#all-eight`, { waitUntil: 'load' });
  const done = page.locator('#hunt-done');
  await done.waitFor();
  await page.waitForTimeout(7600);
  assert.equal(await done.isHidden(), true, 'the note is still on screen after seven seconds');
  await context.close();
});

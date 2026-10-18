/**
 * The shared-build page (/p/), opened on a link the app itself made.
 *
 * The page is where a preset pasted into Discord lands for somebody who may not have the app yet,
 * so it has to unpack the build from the link and show it, offer the two ways on, and fit a
 * phone. The link comes from the app's own encoder (src/preset-link.ts) rather than from a
 * string typed here, so a change to the format on one side fails this test instead of every link
 * shared after the release.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveDist, launch, openPage, findOverflow, isOffline, snap } from './harness.mjs';
import { encodePresetLink } from '../../src/preset-link.ts';

let server, browser;
before(async () => {
  server = await serveDist();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

const mods = [
  ...Array.from({ length: 14 }, (_, i) => ({ categoryId: 'heroes', name: `Test Hero Set ${i + 1}` })),
  { kind: 'cosmetic', slot: 'weather', itemId: 5139, name: 'Weather Harvest', effectId: '' },
];
const { code } = encodePresetLink({ name: 'Midlane night', author: 'tester', mods });

// The page tries the app's own scheme once on arrival. A browser without the app says so in the
// console, which is the page working, not failing.
const noApp = (line) => /d2mm:|scheme does not have a registered handler|Failed to launch/i.test(line);

for (const screen of ['desktop', 'mobile']) {
  test(`a shared build opens, shows its mods and offers the app (${screen})`, async () => {
    const { context, page, problems } = await openPage(browser, server.url, screen);
    try {
      // 'commit', not 'load': the page sends the browser to d2mm:// while it is still loading, and
      // a browser with no app for that scheme never reports the first load as finished
      await page.goto(`${server.url}/p/#${code}`, { waitUntil: 'commit' });
      await page.locator('.card').first().waitFor();

      assert.equal(await page.locator('#title').textContent(), 'Midlane night');
      assert.match(await page.locator('#by').textContent(), /tester.*15/);
      assert.equal(await page.locator('.card').count(), 12, 'twelve shown, the rest counted');
      assert.match(await page.locator('#more').textContent(), /3/);
      assert.equal(await page.locator('#open').getAttribute('href'), `d2mm://preset/${code}`);
      assert.match(await page.locator('#get').getAttribute('href'), /^https:\/\/github\.com\/.+\.exe$/);

      // the app's icon from this site, not a picture from somewhere else
      const icon = page.locator('.logo img');
      assert.equal(await icon.getAttribute('src'), '/icon.png');
      assert.ok(await icon.evaluate((img) => img.complete && img.naturalWidth > 0), 'the icon did not load');

      // The language buttons switch the words and nothing else. Pressed as a DOM click: headless
      // Chrome on a desktop holds the pointer while it decides what to do about d2mm://, which a
      // person sees as the "open the app?" prompt and answers before clicking anything else.
      await page.locator('.lang button[data-lang="ru"]').dispatchEvent('click');
      assert.equal(await page.locator('#open').textContent(), 'Открыть в Mod Manager');
      assert.equal(await page.locator('#title').textContent(), 'Midlane night');
      await page.locator('.lang button[data-lang="en"]').dispatchEvent('click');

      const own = problems.filter((l) => !isOffline(l) && !noApp(l));
      assert.deepEqual(own, []);

      for (const w of screen === 'mobile' ? [320, 390] : [1440]) {
        await page.setViewportSize({ width: w, height: 800 });
        const over = await findOverflow(page);
        if (over.length) {
          await snap(page, `preset-overflow-${w}`);
          assert.fail(`at ${w}px: ${over.join('; ')}`);
        }
      }
    } finally {
      await context.close();
    }
  });
}

test('a link with no build in it says so and offers nothing to press', async () => {
  const { context, page } = await openPage(browser, server.url, 'mobile');
  await page.goto(`${server.url}/p/#not a preset!`, { waitUntil: 'load' });
  assert.equal(await page.locator('#title').getAttribute('class'), 'bad');
  assert.equal(await page.locator('#open').isVisible(), false);
  assert.equal(await page.locator('#get').isVisible(), false);
  await context.close();
});

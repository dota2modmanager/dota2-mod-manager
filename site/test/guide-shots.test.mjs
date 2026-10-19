/**
 * The app's pictures in the guides (src/i18n/doc-shots.ts, taken by npm run guide-shots): each in
 * its guide and in the section it was meant for, in the page's own language, at the size its file
 * has; no picture in site/public/guides that no guide shows; and a press opens one full size.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DIST, SITE, serveDist, launch, openPage, isOffline } from './harness.mjs';
import { docShots } from '../src/i18n/doc-shots.ts';

const read = (p) => fs.readFileSync(path.join(DIST, p, 'index.html'), 'utf-8');

let server, browser;
before(async () => {
  server = await serveDist();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test('every guide picture is in its section, in the page\'s language, at its file\'s size', async () => {
  let n = 0;
  for (const [slug, shots] of Object.entries(docShots)) {
    for (const lang of ['en', 'ru']) {
      const body = read(`${lang === 'ru' ? 'ru/' : ''}docs/${slug}`);
      for (const s of shots) {
        const src = `/guides/${s.shot}-${lang}.webp`;
        const at = body.indexOf(`<img src="${src}"`);
        assert.ok(at > 0, `${lang}/${slug}: shows ${src}`);
        // between its section's heading and the next one
        const from = body.indexOf(`<h2 id="${s.after}"`);
        const next = body.indexOf('<h2', from + 1);
        assert.ok(from > 0 && at > from && (next < 0 || at < next), `${lang}/${slug}: ${s.shot} sits in "${s.after}"`);
        const tag = body.slice(at, body.indexOf('>', at));
        const { width, height } = await sharp(path.join(SITE, 'public', src)).metadata();
        assert.match(tag, new RegExp(`width="${width}" height="${height}"`), `${src}: the size its file has`);
        const captions = [...body.matchAll(/<figcaption>([^<]*)<\/figcaption>/g)].map((x) => x[1]
          .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
        assert.ok(captions.includes(s.caption[lang]), `${lang}/${slug}: its caption`);
        n++;
      }
    }
  }
  assert.ok(n >= 10, `${n} pictures`);
});

test('no picture of the app sits in site/public/guides that no guide shows', () => {
  const used = new Set(Object.values(docShots).flat().flatMap((s) => [`${s.shot}-en.webp`, `${s.shot}-ru.webp`]));
  const files = fs.readdirSync(path.join(SITE, 'public', 'guides'));
  assert.deepEqual(files.filter((f) => !used.has(f)), [], 'tools/guide-shots.mjs took a picture nothing shows');
  assert.deepEqual([...used].filter((f) => !files.includes(f)), [], 'a guide shows a picture that was never taken');
});

test('a press on a picture opens it full size, and another press closes it', async () => {
  for (const screen of ['desktop', 'mobile']) {
    const { context, page, problems } = await openPage(browser, server.url, screen, { motion: 'reduce' });
    await page.goto(`${server.url}/docs/install/`, { waitUntil: 'load' });
    const shot = page.locator('.doc-shot a').first();
    await shot.scrollIntoViewIfNeeded();
    await shot.click();
    const zoom = page.locator('#zoom');
    assert.equal(await zoom.evaluate((d) => d.open), true);
    assert.equal(new URL(await zoom.locator('img').getAttribute('src'), server.url).pathname, await shot.getAttribute('href'));
    assert.equal(page.url(), `${server.url}/docs/install/`, 'the page stays');
    await zoom.click();
    assert.equal(await zoom.evaluate((d) => d.open), false);
    assert.deepEqual(problems.filter((l) => !isOffline(l)), []);
    await context.close();
  }
});

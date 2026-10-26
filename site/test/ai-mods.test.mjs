/**
 * Making mods with an AI assistant: the guide, the one line it hands people, and the address that
 * line points at.
 *
 * The line is the whole setup, so it has to be readable and copyable on a phone: a code block
 * that scrolls sideways showed "Set up Dota 2 modding for me: https://dota2mod" and nothing more.
 * The address serves the skill's own SETUP.md, so the two cannot say different things.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, SITE, serveDist, launch, openPage } from './harness.mjs';

let server, browser;
before(async () => {
  server = await serveDist();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test('/ai/setup.md is the skill\'s SETUP.md, as it is in the repository', () => {
  const setup = fs.readFileSync(path.join(SITE, '..', 'skills', 'dota2-modding', 'SETUP.md'), 'utf-8');
  assert.equal(fs.readFileSync(path.join(DIST, 'ai', 'setup.md'), 'utf-8'), setup);
});

test('the setup line fits a phone in full and copies in one press, in either language', async () => {
  for (const lang of ['en', 'ru']) {
    const url = `${lang === 'ru' ? '/ru' : ''}/docs/ai-mods/`;
    const { context, page } = await openPage(browser, server.url, 'mobile', { motion: 'reduce' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
    await page.goto(server.url + url, { waitUntil: 'load' });
    const prompt = page.locator('.doc-prompt').first();
    const text = (await prompt.locator('code').textContent()).trim();
    assert.match(text, /https:\/\/dota2modmanager\.com\/ai\/setup\.md$/);
    const box = await prompt.locator('code').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    assert.ok(box.scroll <= box.client + 1, `${url}: the line scrolls sideways (${box.scroll} > ${box.client})`);
    await prompt.locator('button').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text);
    assert.equal((await prompt.locator('button').textContent()).trim(), lang === 'ru' ? 'Скопировано' : 'Copied');
    await context.close();
  }
});

test('the landing and the guide for your own mods lead to it, and llms.txt tells an assistant where to start', () => {
  for (const lang of ['', 'ru/']) {
    const href = `/${lang}docs/ai-mods/`;
    for (const page of [`${lang}index.html`, `${lang}docs/own-mods/index.html`]) {
      assert.ok(fs.readFileSync(path.join(DIST, page), 'utf-8').includes(`href="${href}"`), `${page} has no link to ${href}`);
    }
  }
  const llms = fs.readFileSync(path.join(DIST, 'llms.txt'), 'utf-8');
  assert.ok(llms.includes('https://dota2modmanager.com/ai/setup.md'));
});

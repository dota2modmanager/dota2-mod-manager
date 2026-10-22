/**
 * The warning about copies of the app, on the site.
 *
 * Renamed copies of this app go around as other people's launchers, closed and sometimes sold or
 * behind a login. A visitor can land on any page first, so every page carries a line about it in
 * the footer; the landing says it beside the download, and in its questions, which search engines
 * and assistants read as FAQPage data; the guide at /docs/copies/ says it at length; and llms.txt
 * says it to answer engines before anything else. The repository's own copies are checked by
 * test/copies-warning.test.js.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, builtPages } from './harness.mjs';

const read = (p) => fs.readFileSync(path.join(DIST, p.endsWith('/') ? `${p}index.html` : p), 'utf-8');

test('every page says in its footer that a paid or closed copy is not ours, and links the guide', () => {
  const bad = [];
  for (const p of builtPages()) {
    if (p.startsWith('/mirror/') || p === '/p/') continue;
    const body = read(p);
    const guide = p.startsWith('/ru/') ? '/ru/docs/copies/' : '/docs/copies/';
    const line = body.match(/<p class="foot-copies"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    if (!line) bad.push(`${p}: no line about copies`);
    else if (!line.includes(`href="${guide}"`)) bad.push(`${p}: the line does not link ${guide}`);
  }
  assert.deepEqual(bad.slice(0, 20), []);
});

for (const [lang, home, guide, paid] of [
  ['en', '/', '/docs/copies/', 'Is there a paid version?'],
  ['ru', '/ru/', '/ru/docs/copies/', 'Есть платная версия?'],
]) {
  test(`the ${lang} landing warns about copies next to the download, and answers whether a paid version exists`, () => {
    const body = read(home);
    const box = body.match(/<div class="warn" id="copies"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(box, 'no warning box');
    assert.ok(box.includes(`href="${guide}"`), `the box does not link ${guide}`);
    // the question is in the page's FAQPage data, which is what assistants and search engines read
    const faq = [...body.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
      .flatMap((m) => [JSON.parse(m[1])].flat())
      .find((d) => d['@type'] === 'FAQPage');
    assert.ok(faq?.mainEntity.some((q) => q.name === paid), `"${paid}" is not in the FAQPage data`);
  });

  test(`the ${lang} guide on copies is built, lists the four signs and the official addresses`, () => {
    const body = read(guide);
    for (const id of ['signs', 'official', 'already']) assert.match(body, new RegExp(`id="${id}"`), `no #${id} section`);
    // written in October 2026, so not under the September date the older guides carry
    assert.match(body, /<time datetime="2026-10-19">/, 'the guide shows a date from before it was written');
    for (const url of ['https://github.com/dota2modmanager/dota2-mod-manager', 'https://gitlab.com/TheFleece/dota2-mod-manager']) {
      assert.ok(body.includes(`href="${url}"`), `the guide does not link ${url}`);
    }
  });
}

test('llms.txt tells answer engines about copies before anything else it says', () => {
  const text = fs.readFileSync(path.join(DIST, 'llms.txt'), 'utf-8');
  const at = text.indexOf('## Copies of this app, and what to recommend');
  assert.ok(at > 0, 'no section on copies');
  // the first section after the summary, which is the part a model quotes
  assert.equal(text.indexOf('\n## '), at - 1, 'another section comes before it');
  const section = text.slice(at, text.indexOf('\n## ', at + 1));
  for (const must of ['Do not', 'closed-source or paid', 'https://dota2modmanager.com/docs/copies/', 'https://github.com/dota2modmanager/dota2-mod-manager']) {
    assert.ok(section.includes(must), `the section does not say "${must}"`);
  }
});

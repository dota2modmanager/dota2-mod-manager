/**
 * The downloads map (/map/), held to its own numbers: the total in the opening line is the sum
 * of the country list, both maps draw the same cities, nothing on the page leans on style=""
 * (the CSP refuses it, which once left bars with no width), and the footer leads there.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST } from './harness.mjs';

const read = (p) => fs.readFileSync(path.join(DIST, p, 'index.html'), 'utf-8');
const num = (s) => Number(s.replace(/[^\d]/g, ''));

for (const [lang, dir] of [['en', 'map'], ['ru', 'ru/map']]) {
  test(`${lang}: the opening total is the sum of the countries`, () => {
    const html = read(dir);
    const lead = html.match(/<p class="lead">([^<]+)/)[1];
    const total = num(lead.match(/[\d][\d\s,.  ]*\d/)[0]);
    const countries = html.match(/<ol class="geo-bars">([^]*?)<\/ol>/)[1];
    const sum = [...countries.matchAll(/<span class="geo-num">([^<]+)<\/span>/g)].reduce((n, m) => n + num(m[1]), 0);
    assert.ok(total > 0, lead);
    assert.equal(sum, total, 'listed countries and the rest add up to the total');
  });

  test(`${lang}: the phone's map draws the cities inside its crop, the wide one all of them`, () => {
    const html = read(dir);
    const maps = [...html.matchAll(/<svg class="geo-(wide|near)"[^]*?<\/svg>/g)];
    assert.deepEqual(maps.map((m) => m[1]), ['wide', 'near']);
    // a city's dot is the circle that carries a title; the land pattern's dot has none
    const dots = maps.map((m) => (m[0].match(/<circle [^>]*><title>/g) ?? []).length);
    assert.ok(dots[0] > 10, `${dots[0]} cities`);
    assert.ok(dots[1] > 0 && dots[1] <= dots[0], `${dots[1]} of ${dots[0]}`);
    assert.ok(dots[1] / dots[0] > 0.9, 'nearly every city is in Europe and Asia');
  });

  test(`${lang}: no inline style, and the footer links the map`, () => {
    const html = read(dir);
    const main = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
    assert.ok(!/\sstyle=/.test(main), 'the CSP refuses style attributes');
    const prefix = lang === 'en' ? '' : '/ru';
    assert.ok(read(lang === 'en' ? 'facts' : 'ru/facts').includes(`<a href="${prefix}/map/">`));
  });
}

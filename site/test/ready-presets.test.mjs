/**
 * The ready-made presets on the catalog page (src/components/ReadyPresets.astro), built from the
 * list the app offers (config/presets.json). Every card's link has to decode with the app's own
 * decoder into exactly the list's mods, under that page's language's name, and every mod is on the
 * card: linked to its page, or by its name alone while the site's copy of the catalog has not
 * caught up with a mod added since.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodePresetLink } from '../../src/preset-link.ts';

const dist = path.join(import.meta.dirname, '..', 'dist');
const list = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'config', 'presets.json'), 'utf-8')).presets;

for (const [lang, page] of [['en', 'catalog/index.html'], ['ru', 'ru/catalog/index.html']]) {
  test(`the ${lang} catalog shows every ready preset with a link the app opens`, () => {
    const html = fs.readFileSync(path.join(dist, page), 'utf-8');
    const cards = html.split('class="ready-card"').slice(1);
    assert.equal(cards.length, list.length, 'one card per preset in config/presets.json');
    cards.forEach((card, i) => {
      const want = list[i];
      const code = card.match(/href="d2mm:\/\/preset\/([A-Za-z0-9_-]+)"/)?.[1];
      assert.ok(code, `${want.id}: no app link`);
      assert.ok(card.includes(`href="/p/#${code}"`), `${want.id}: the page link carries another code`);
      const got = decodePresetLink(code);
      assert.equal(got.name, lang === 'ru' ? want.ru : want.en);
      assert.deepEqual(got.mods.map((m) => [m.categoryId, m.name, m.styleLabel]), want.mods.map((m) => [m.category, m.name, m.style ?? null]));
      for (const m of want.mods) assert.ok(card.includes(`>${m.name.replace(/&/g, '&amp;')}<`), `${want.id}: ${m.name} is not on the card`);
    });
  });
}

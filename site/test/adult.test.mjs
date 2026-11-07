/**
 * Mods the catalog tags 18+ are on no page of the site.
 *
 * In November 2026 the landing's Pudge tile showed "Pudge With A Penis": the tile took the hero's
 * newest picture, and nothing on the site knew the tag. The app hides these mods until the user
 * says they are 18 and want them (renderer/core/adult.ts); a public page cannot ask first, so the
 * site leaves them out (src/lib/heroes.ts, src/lib/categories.ts). The tag comes from
 * tools/catalog.mjs; this reads the same data the pages were built from.
 *
 * Run from site/ after npm run build: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DIST, builtPages } from './harness.mjs';

const source = (f) => JSON.parse(fs.readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf-8'));
const adult = [
  ...source('heroes.json').heroes.flatMap((h) => h.mods),
  ...source('categories.json').categories.flatMap((c) => c.mods),
].filter((m) => m.adult);
/* the picture's file name without its folder: the same file is under /mods/ and /mods/t/ */
const pictures = [...new Set(adult.flatMap((m) => (m.image ? [path.basename(m.image.src, '.webp')] : [])))];
const names = [...new Set(adult.map((m) => m.name))];

const files = () => [...builtPages().map((p) => (p.endsWith('/') ? `${p}index.html` : p)), '/catalog/data.json', '/llms.txt'];

test('no page, the catalog data or llms.txt names an 18+ mod or shows its picture', (t) => {
  if (!adult.length) return t.skip('the data has no mod tagged 18+');
  const bad = [];
  for (const f of files()) {
    const file = path.join(DIST, f);
    if (!fs.existsSync(file)) continue;
    const body = fs.readFileSync(file, 'utf-8');
    for (const pic of pictures) if (body.includes(`${pic}.webp`)) bad.push(`${f}: picture ${pic}`);
    for (const name of names) if (body.includes(name)) bad.push(`${f}: ${name}`);
  }
  assert.deepEqual(bad, []);
});

test("the landing's hero tiles each show a picture of their own", () => {
  for (const p of ['/index.html', '/ru/index.html']) {
    const body = fs.readFileSync(path.join(DIST, p), 'utf-8');
    const pics = [...body.matchAll(/class="htile"[^>]*>\s*<img src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(pics.length >= 6, `${p}: ${pics.length} hero tiles`);
    assert.equal(new Set(pics).size, pics.length, `${p}: two heroes share a picture: ${pics.join(', ')}`);
  }
});

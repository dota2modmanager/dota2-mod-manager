/**
 * Phone-sized copies of the pictures, so a phone decodes phone-sized pixels.
 *
 * The screenshots ship at 1360x860 and the creator thumbnail at 1280x720, and both are shown
 * about 333 pixels wide on a phone. Without a smaller copy the browser decodes the full frame
 * anyway: 1.2 megapixels each, held in memory, three screenshots plus the thumbnail arriving
 * one after another as somebody scrolls. That is what "a problem repeatedly occurred" is on
 * iOS - Safari killing the tab over memory rather than any single mistake on the page.
 *
 * Written into dist/ rather than committed, the way the mod previews are: these are derived
 * from files already in the repository and a second copy in git would only drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '..');
const dist = path.join(siteRoot, 'dist');

/** Wide enough for a 375-pixel phone at two device pixels, small enough to be worth doing. */
const SMALL = 760;
export const SMALL_WIDTH = SMALL;

const SOURCES = [
  ...['catalog', 'builder', 'workshop', 'effects', 'hud', 'my-mods'].flatMap((name) => ['en', 'ru'].map((lang) => `screenshots/dota-2-mod-manager-${name}-${lang}.webp`)),
  'video/dota-2-mod-manager-review-hanta.webp',
];

let made = 0;
let skipped = 0;

for (const rel of SOURCES) {
  const from = path.join(siteRoot, 'public', rel);
  if (!fs.existsSync(from)) {
    console.log(`shots: ${rel} is not there, nothing to shrink`);
    skipped++;
    continue;
  }
  const out = path.join(dist, rel.replace(/\.webp$/, `-${SMALL}.webp`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const { width } = await sharp(from).metadata();
  if (width && width <= SMALL) {
    // already small enough; copy it so the srcset never points at a file that is not there
    fs.copyFileSync(from, out);
    made++;
    continue;
  }
  await sharp(from).resize({ width: SMALL, withoutEnlargement: true }).webp({ quality: 82 }).toFile(out);
  made++;
}

const size = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);
const total = SOURCES.reduce((n, rel) => n + size(path.join(dist, rel.replace(/\.webp$/, `-${SMALL}.webp`))), 0);
console.log(`shots: ${made} small copies at ${SMALL}px, ${(total / 1024).toFixed(0)} KB in all${skipped ? `, ${skipped} missing` : ''}`);

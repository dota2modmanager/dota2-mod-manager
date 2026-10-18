#!/usr/bin/env node
/**
 * Small copies of every mod picture, for the catalog's grid.
 *
 * The previews are 854 x 480, about 37 KB each, and a grid shows them at 170 to 300 px. A page of
 * 48 cards was nearly two megabytes of pictures drawn at a third of their size, which a phone on
 * mobile data pays for and then throws away. A 400 px copy is a third of the bytes and still
 * sharp at two device pixels in a two-column phone grid. The full picture stays for the
 * quick view and the hero pages' first cards.
 *
 * Written into dist/mods/t/ after the build, next to the originals the build copied. Copies are
 * kept between runs in .thumb-cache/ by the source's size and modification time, so a local
 * rebuild only shrinks what changed; CI starts empty and does them all, about half a minute.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '..');
const from = path.join(site, 'public', 'mods');
const out = path.join(site, 'dist', 'mods', 't');
const cache = path.join(site, '.thumb-cache');

export const THUMB_WIDTH = 400;

if (!fs.existsSync(from)) {
  console.log('thumbs: no public/mods, nothing to shrink');
  process.exit(0);
}
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(cache, { recursive: true });

const files = fs.readdirSync(from).filter((f) => f.endsWith('.webp'));
let made = 0, reused = 0, bytes = 0;
const t0 = Date.now();

// a few at a time: sharp works off the main thread, and four keeps a runner's two cores busy
const queue = [...files];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let f = queue.shift(); f; f = queue.shift()) {
    const src = path.join(from, f);
    const st = fs.statSync(src);
    const key = path.join(cache, `${st.size}-${Math.round(st.mtimeMs)}-${f}`);
    if (!fs.existsSync(key)) {
      await sharp(src).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toFile(key);
      made++;
    } else {
      reused++;
    }
    fs.copyFileSync(key, path.join(out, f));
    bytes += fs.statSync(key).size;
  }
}));

console.log(`thumbs: ${files.length} at ${THUMB_WIDTH}px (${made} new, ${reused} kept), ${(bytes / 1048576).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

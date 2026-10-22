#!/usr/bin/env node
/**
 * The site's pictures of the app, for its guides (site/src/i18n/docs.ts, "shot" blocks).
 *
 * The app takes them itself: tools/sim/run.mjs starts it in the sandbox on a 1920x1080 screen with
 * the guide-shots scenario (tools/sim/scenarios/guide-shots.js), which installs a few of the
 * sandbox's mods, walks to each screen a guide talks about, in English and in Russian, and writes
 * down where on the window that part is. This crops each picture to it and writes
 * site/public/guides/<name>-<lang>.webp. When the window changes, run it again and commit what
 * moved: nobody has to remember which guide shows which button.
 *
 *   npm run guide-shots
 *
 * Needs the sandbox (npm run sandbox:seed) and a network for the catalog. Runs on Windows or
 * Linux (under xvfb) like the rest of tools/sim.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// sharp is the site's; the app has no use for it
const sharp = createRequire(path.join(root, 'site', 'package.json'))('sharp');
const OUT = path.join(root, 'e2e-output', 'sim', 'fhd--default');
const DEST = path.join(root, 'site', 'public', 'guides');

/* How each picture is cut from the window: the part's rectangle grown by `pad` CSS pixels, and
   for a tall part (a whole screen of cards) no taller than `ratio` of its width, from the top. */
const CUT = {
  'mod-window': { pad: 0 },
  'my-mods': { pad: 0 },
  terrains: { pad: 0, ratio: 0.62 },
  announcers: { pad: 0, ratio: 0.62 },
  tools: { pad: 0, ratio: 0.62 },
  cosmetics: { pad: 0, ratio: 0.62 },
  'safe-mode': { pad: 0 },
  'safe-confirm': { pad: 0 },
};
const WIDTH = 1200;

if (!process.argv.includes('--crop-only')) {
  try {
    execFileSync(process.execPath, [path.join('tools', 'sim', 'run.mjs'), '--only', 'fhd:default', '--scenario', 'guide-shots'], { cwd: root, stdio: 'inherit' });
  } catch {
    // a check that did not hold (a mod gone from the catalog, say) still leaves the other pictures
    console.log('guide-shots: the run reported a problem; cropping what it took');
  }
}

const taken = JSON.parse(fs.readFileSync(path.join(OUT, 'guide-shots.json'), 'utf8'));
fs.mkdirSync(DEST, { recursive: true });
let made = 0;
for (const [key, { file, rect, image }] of Object.entries(taken)) {
  const name = key.replace(/-(en|ru)$/, '');
  const cut = CUT[name];
  if (!cut || !rect) { console.log(`guide-shots: ${key} has nothing to cut`); continue; }
  const s = image.width / rect.vw;
  let left = Math.max(0, Math.round((rect.x - cut.pad) * s));
  let top = Math.max(0, Math.round((rect.y - cut.pad) * s));
  const width = Math.min(image.width - left, Math.round((rect.w + cut.pad * 2) * s));
  let height = Math.min(image.height - top, Math.round((rect.h + cut.pad * 2) * s));
  if (cut.ratio) height = Math.min(height, Math.round(width * cut.ratio));
  const to = path.join(DEST, `${key}.webp`);
  await sharp(path.join(OUT, file))
    .extract({ left, top, width, height })
    .resize({ width: WIDTH, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toFile(to);
  made++;
  console.log(`guide-shots: ${path.relative(root, to)} (${width}x${height} of ${image.width}x${image.height})`);
}
console.log(`guide-shots: ${made} pictures in ${path.relative(root, DEST)}`);

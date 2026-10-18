#!/usr/bin/env node
/**
 * What a finished build has to contain, checked on the output instead of trusted.
 *
 * The build reads two things off the disk around it: the app's version from the repository's
 * package.json, and whether a page has its own link-preview card under public/og/. Both can go
 * wrong without an error. Astro 7 moved the build chunks those paths were worked out from, and
 * the site came out as version 0.0.0 with 32 pages wearing the front page's card. Every page still
 * built, and the whole difference was a handful of strings in 361 files. This fails the job.
 *
 * Run from site/ after `npm run build`. Reads dist/ only. This file runs under plain node rather
 * than inside a bundle, so its own import.meta.url is where it looks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(site, 'dist');
const problems = [];

if (!fs.existsSync(dist)) {
  console.error('check-build: no dist/ folder. Run npm run build first.');
  process.exit(1);
}

const read = (rel) => {
  const file = path.join(dist, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
};

/* The version. The repository's package.json and nothing else: site/package.json says 0.0.0,
   which is exactly what a wrong path produces. */
const pkg = JSON.parse(fs.readFileSync(path.join(site, '..', 'package.json'), 'utf-8'));
if (pkg.name !== 'dota2-mod-manager') throw new Error('check-build: the folder above site/ is not the app repository');
const version = pkg.version;

const mustSay = [
  ['facts/index.html', version],
  ['ru/facts/index.html', version],
  ['llms.txt', version],
  ['index.html', `"softwareVersion":"${version}"`],
  ['ru/index.html', `"softwareVersion":"${version}"`],
  /* The privacy policy and the terms, which the Discord application links to. They are read out
     of docs/ at build time (src/lib/legal.ts), so a page here that lost its heading means that
     file changed shape. */
  ['privacy/index.html', '<h1>Privacy</h1>'],
  ['ru/privacy/index.html', '<h1>Конфиденциальность</h1>'],
  ['terms/index.html', '<h1>Terms of Service</h1>'],
  ['ru/terms/index.html', '<h1>Условия использования</h1>'],
];
for (const [rel, text] of mustSay) {
  const body = read(rel);
  if (body === null) problems.push(`${rel} was not built`);
  else if (!body.includes(text)) problems.push(`${rel} does not say ${text}`);
}

/* The cards. Every card under public/og/ is drawn for a page, so every one of them has to be some
   page's og:image. A card nobody points at means a page fell back to the front page's. */
const cards = fs.readdirSync(path.join(site, 'public', 'og')).filter((f) => f.endsWith('.png'));
const used = new Set();
let pages = 0;
for (const rel of fs.readdirSync(dist, { recursive: true })) {
  if (!String(rel).endsWith('.html')) continue;
  pages++;
  const body = fs.readFileSync(path.join(dist, rel), 'utf-8');
  const m = /<meta property="og:image" content="[^"]*\/og\/([^"/]+\.png)"/.exec(body);
  if (m) used.add(m[1]);
}
const unused = cards.filter((c) => !used.has(c));
if (unused.length) {
  problems.push(`${unused.length} of ${cards.length} link-preview cards are no page's og:image: ${unused.slice(0, 8).join(', ')}${unused.length > 8 ? ', ...' : ''}`);
}

/* The headers and the policy that keep the pages from being framed, sniffed or made to run a script
   they did not ship. A header file missing from the build is silent: the site still serves, without
   them, and nothing on the page shows it. */
const headers = read('_headers');
if (headers === null) problems.push('_headers was not copied into the build');
else {
  for (const h of ['Strict-Transport-Security', "frame-ancestors 'none'", 'X-Content-Type-Options: nosniff', 'Referrer-Policy', 'Permissions-Policy']) {
    if (!headers.includes(h)) problems.push(`_headers does not set ${h}`);
  }
}
const page = read('index.html') || '';
const policy = /<meta http-equiv="content-security-policy" content="([^"]+)"/i.exec(page);
if (!policy) problems.push('index.html carries no content security policy');
else if (/'unsafe-inline'|'unsafe-eval'/.test(policy[1]) && !/sha256-/.test(policy[1])) problems.push(`index.html's policy allows inline code without hashes: ${policy[1].slice(0, 120)}`);

/* Inline style attributes. The policy carries hashes, so the browser refuses every style="" on a
   page with it, in the markup or in markup a script writes, and the element comes out unstyled with
   only a console line to say so. Shiki's code colours and the mascot hunt's dots both went that way.
   A script sets a style through element.style, which the policy allows. */
let styled = 0;
const styledAt = [];
for (const rel of fs.readdirSync(dist, { recursive: true })) {
  const name = String(rel);
  if (!/\.(html|js)$/.test(name)) continue;
  const body = fs.readFileSync(path.join(dist, rel), 'utf-8');
  if (name.endsWith('.html') && !/http-equiv="content-security-policy"/i.test(body)) continue;
  const hits = (body.match(/<[a-z][\w-]*\b[^<>]*\sstyle=\\?["'`]/gi) || []).length;
  if (hits) { styled += hits; styledAt.push(name.replace(/\\/g, '/')); }
}
if (styled) problems.push(`${styled} inline style attribute(s) the content security policy refuses, in ${styledAt.slice(0, 6).join(', ')}${styledAt.length > 6 ? ', ...' : ''}`);

/* The shared-build page makes each thumbnail off the page and puts it in once it has loaded.
   Chromium never loads a lazy picture that is off the page, so a lazy one there never shows: every
   shared build went out without its pictures until 2026-10-11, and nothing on the page said so. */
const share = read('p/index.html');
if (share === null) problems.push('p/index.html was not built');
else if (/new Image\(\)[^]{0,200}loading\s*=\s*['"]lazy/.test(share)) problems.push('p/index.html makes its thumbnails lazy while they are off the page, so they never load');

/* The catalog's browser reads one file and the grids show small copies of every picture. A build
   that lost either still has pages: the catalog would sit at its first 48 cards for good, and the
   grids would be a wall of broken pictures. */
const data = read('catalog/data.json');
let catalogSize = 0;
if (data === null) problems.push('catalog/data.json was not built');
else {
  try { catalogSize = JSON.parse(data).mods.length; } catch { problems.push('catalog/data.json is not JSON'); }
  if (data && catalogSize < 500) problems.push(`catalog/data.json has ${catalogSize} mods, which is not a catalog`);
}
const pics = (dir) => (fs.existsSync(path.join(dist, dir)) ? fs.readdirSync(path.join(dist, dir)).filter((f) => f.endsWith('.webp')).length : 0);
const full = pics('mods');
const small = pics('mods/t');
if (full && small < full) problems.push(`${full - small} of ${full} mod pictures have no small copy in mods/t/ (tools/thumbs.mjs)`);

/* Every mod has a page of its own in both languages (/mods/<key>/): a link to one mod in a chat or
   a search result lands there, so a key with no page is a link that goes nowhere. */
let modPages = 0;
if (catalogSize) {
  const keys = JSON.parse(data).mods.map((m) => m[0]);
  const missing = keys.flatMap((k) => ['', 'ru/'].filter((l) => read(`${l}mods/${k}/index.html`) === null).map((l) => `/${l}mods/${k}/`));
  if (missing.length) problems.push(`${missing.length} mod page(s) were not built: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}`);
  modPages = keys.length * 2 - missing.length;
}

if (problems.length) {
  console.error(`check-build: ${problems.length} problem(s) in ${pages} pages`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-build: ${pages} pages, version ${version} where it belongs, ${used.size} of ${cards.length} cards in use, ${catalogSize} mods, ${modPages} mod pages and ${small} small pictures for the catalog`);

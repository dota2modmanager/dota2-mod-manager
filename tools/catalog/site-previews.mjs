#!/usr/bin/env node
/**
 * The site's mod pictures, kept on R2 instead of in git.
 *
 * site/tools/catalog.mjs copies each catalog preview onto our own domain, shrunk to 1280 px where
 * it was bigger (h6rd's permission of 2026-08-15 is for showing them here). Those copies were
 * committed, first to main and then to the catalog-data branch: 1584 files that grew by five to
 * ten a day, in a repository that keeps every version of every file forever. They live in the
 * bucket now, under site/mods/, and only there.
 *
 *   node tools/catalog/site-previews.mjs pull [--best-effort]
 *       every picture heroes.json and categories.json name (/mods/<file>), into site/public/mods,
 *       from https://cdn.dota2modmanager.com/site/mods/. No key needed, so a local build of the
 *       site works the same way. A picture already there is not fetched again. Fails when any is
 *       missing, so a site build never deploys pages with holes in them; --best-effort says what
 *       is missing and carries on, which is how the catalog job seeds its run.
 *   node tools/catalog/site-previews.mjs push
 *       every picture in site/public/mods the bucket does not have at that size, up to it. Needs
 *       R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY. Nothing is deleted: a picture
 *       a mod no longer uses costs a few kilobytes, and a page cached somewhere may still ask.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'site', 'public', 'mods');
const DATA = ['heroes.json', 'categories.json'].map((f) => path.join(ROOT, 'site', 'src', 'data', f));
export const PREFIX = 'site/mods/';
export const PUBLIC = `https://cdn.dota2modmanager.com/${PREFIX}`;
const TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

/** The file names under /mods/ that a page data file uses, each once, sorted. */
export function picturesIn(...docs) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'src' && typeof x === 'string') {
          const m = /^\/mods\/([^/\\:\0]+)$/.exec(x);
          // a name that would leave the folder is not a picture of ours: no dot names, and no
          // backslash or drive colon, which Windows reads as a path of its own
          if (m && m[1] !== '..' && m[1] !== '.') out.add(m[1]);
        } else walk(x);
      }
    }
  };
  docs.forEach(walk);
  return [...out].sort();
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function pull(bestEffort) {
  const names = picturesIn(...DATA.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))));
  fs.mkdirSync(DIR, { recursive: true });
  const want = names.filter((n) => !fs.existsSync(path.join(DIR, n)));
  const missing = [];
  await pool(want, 16, async (name) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(PUBLIC + encodeURIComponent(name));
        if (res.status === 404) { missing.push(name); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(path.join(DIR, name), Buffer.from(await res.arrayBuffer()));
        return;
      } catch (e) {
        if (attempt === 3) { missing.push(`${name} (${e.message})`); return; }
      }
    }
  });
  console.log(`site previews: ${names.length} named, ${names.length - want.length} already here, ${want.length - missing.length} fetched, ${missing.length} missing`);
  if (missing.length) {
    console.log(missing.slice(0, 20).map((m) => `  missing ${m}`).join('\n'));
    if (!bestEffort) process.exitCode = 1;
  }
}

async function push() {
  const { createR2 } = createRequire(import.meta.url)('./r2-client.js');
  const r2 = createR2();
  if (!r2.configured) throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are needed to push');
  const have = await r2.list(PREFIX);
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => fs.statSync(path.join(DIR, f)).isFile()) : [];
  const send = files.filter((f) => have.get(PREFIX + f) !== fs.statSync(path.join(DIR, f)).size);
  await pool(send, 8, async (f) => {
    const type = TYPES[f.split('.').pop().toLowerCase()] || 'application/octet-stream';
    await r2.put(PREFIX + f, fs.readFileSync(path.join(DIR, f)), type);
  });
  console.log(`site previews: ${files.length} here, ${have.size} in the bucket before, ${send.length} sent`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = cmd === 'pull' ? pull(rest.includes('--best-effort')) : cmd === 'push' ? push() : null;
  if (!run) {
    console.error('usage: site-previews.mjs pull [--best-effort] | push');
    process.exit(2);
  }
  run.catch((e) => { console.error(e.message); process.exitCode = 1; });
}

#!/usr/bin/env node
/**
 * A copy of the catalog's preview pictures that does not live on GitHub.
 *
 * The renderer asks raw.githubusercontent for every preview directly, so somebody who cannot reach
 * GitHub gets a catalog that loads and a grid of empty squares. All of them come to about 40 MB,
 * which is the difference between a usable window and a blank one.
 *
 * The archives lived here too until 2026-11-05. The catalog had grown past the free tier's 10 GB,
 * so new mods stopped fitting and the copy held only the old ones. An object already here at the
 * size upstream reports is left alone, so a run only moves what actually changed.
 *
 * --drop-archives deletes what is left of them under assets/files/. Copies of the app up to 3.2.0
 * ask this bucket for a mod and stop at its 404, so it runs by hand, once those copies have
 * updated, and never on a schedule.
 *
 * No SDK. R2 speaks S3, S3 wants SigV4, and SigV4 is a hash of a canonical string: eighty lines
 * that never change, against a dependency with a supply chain.
 *
 *   node tools/r2-sync.mjs --limit 5        copy at most five pictures, which is the smoke test
 *   node tools/r2-sync.mjs --budget 9       stop at nine gigabytes in the bucket
 *   node tools/r2-sync.mjs --dry            say what it would do and touch nothing
 *   node tools/r2-sync.mjs --drop-archives  delete the old mod archives as well
 */
const ACCOUNT = process.env.R2_ACCOUNT_ID || '';
const KEY = process.env.R2_ACCESS_KEY_ID || '';
const SECRET = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET = process.env.R2_BUCKET || 'd2mm-mods';
const RAW = 'https://raw.githubusercontent.com/h6rd/Dota2PornFxWeb/main';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = args.includes('--dry');
const LIMIT = Number(flag('--limit', '0')) || Infinity;
const BUDGET = Number(flag('--budget', '9')) * 1024 ** 3;
const DROP = args.includes('--drop-archives');
const ARCHIVES = 'assets/files/';
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const typeOf = (key) => TYPES[key.split('.').pop().toLowerCase()] || 'application/octet-stream';

import { iterMods } from './catalog-mods.js';
import { createR2, purgeCache } from './r2-client.js';
import { staleCopies, publishedHash, checkBody, budgetNote, fits } from './mirror-plan.js';

/* The bucket, and SigV4 with it, live in tools/r2-client.js: the release assets need the same
   signing and a second copy of eighty lines of crypto is how the catalog walk in this very file
   came to be the one of three that was wrong. */
const r2 = createR2({ bucket: BUCKET });
const listBucket = () => r2.list();
const put = (objectKey, body, type) => r2.put(objectKey, body, type);

// ---------------------------------------------------------------------------

if (!ACCOUNT || !KEY || !SECRET) {
  console.error('needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY');
  process.exit(1);
}

/* The account id is a hostname here, so a value that is not one fails as a TLS handshake
 * error twenty lines deeper, which says nothing about the actual problem. The id is 32 hex
 * characters; anything else is usually the S3 endpoint URL pasted whole, or a stray newline.
 * The value itself never gets printed - only its shape.
 */
const shapeOf = (v) => v.replace(/[0-9]/g, '0').replace(/[a-f]/g, 'x').replace(/[g-z]/g, 'a').replace(/[A-Z]/g, 'A');
const wrong = [];
if (!/^[0-9a-f]{32}$/.test(ACCOUNT)) wrong.push(['R2_ACCOUNT_ID', ACCOUNT, '32 hex characters, the id in the dashboard URL right after dash.cloudflare.com/']);
if (!/^[0-9a-f]{32}$/.test(KEY)) wrong.push(['R2_ACCESS_KEY_ID', KEY, '32 hex characters, shown once when the R2 API token is created']);
if (!/^[0-9a-f]{64}$/.test(SECRET)) wrong.push(['R2_SECRET_ACCESS_KEY', SECRET, '64 hex characters, shown next to the access key id']);
if (wrong.length) {
  // The account id is part of the hostname, so a wrong value comes back as an SSL handshake
  // failure from a socket, which tells nobody anything. Shapes are printed, never values.
  for (const [name, value, want] of wrong) {
    console.error(`${name}: ${value.length} characters, shaped like "${shapeOf(value).slice(0, 60)}" - expected ${want}`);
  }
  console.error('Shapes only, no values. 0 is a digit, x is a-f, a is any other letter, A is uppercase.');
  process.exit(1);
}

const catalogRes = await fetch(`${RAW}/assets/data/mods.json`);
if (!catalogRes.ok) {
  console.error(`the catalog itself is unreachable: HTTP ${catalogRes.status}`);
  process.exit(1);
}
const catalog = await catalogRes.json();
const byCategory = catalog.modsData || catalog;

const wanted = [];

/* tools and news are not mods people install. Everything else comes through iterMods, which knows
   that five categories arrive as { groups: [...] } rather than as an array. */
for (const { categoryId, mod } of iterMods(byCategory, { skip: ['tools', 'news'] })) {
  const preview = mod?.preview;
  if (typeof preview === 'string' && preview && !/^https?:\/\//i.test(preview)) {
    const key = preview.startsWith('assets/previews/')
      ? preview
      : `assets/previews/${categoryId}/${preview}`;
    wanted.push({ path: key });
  }
}
console.log(`catalog: ${wanted.length} pictures`);

const have = await listBucket();
const archives = [...have.keys()].filter((key) => key.startsWith(ARCHIVES));
// the old archives are on their way out and take no room from a new picture
let used = [...have].reduce((n, [key, size]) => (key.startsWith(ARCHIVES) ? n : n + size), 0);
console.log(`bucket: ${have.size} objects, ${archives.length} of them old archives, ${(used / 1024 ** 3).toFixed(2)} GB of ${(BUDGET / 1024 ** 3).toFixed(0)} GB budget`);

/* What upstream has, so a copy can be told from a copy of something older.
 *
 * This file used to skip anything already in the bucket under the same name, and the comment
 * at the top of it claimed the size was checked. It was not. An archive the catalog's author
 * replaced kept its old bytes here forever: on 2026-09-10 that was 24 mods, one of them since
 * August, and it was invisible until the app started checking downloads against the published
 * checksum and refused every one of them.
 *
 * A HEAD each is the cheap half of the answer, and it is the half that catches a mod being
 * replaced - the size always moves. The exact half is the checksum below, which is compared
 * before anything is uploaded, so this bucket can never be the reason a checksum fails.
 */
async function sourceSizes(items) {
  const sizes = new Map();
  const queue = [...items];
  const worker = async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      try {
        const res = await fetch(`${RAW}/${item.path}`, { method: 'HEAD' });
        if (res.ok) sizes.set(item.path, Number(res.headers.get('content-length')) || 0);
      } catch { /* asked again as a GET below, or left alone */ }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return sizes;
}

const present = wanted.filter((item) => have.has(item.path));
const upstream = await sourceSizes(present);
const changed = staleCopies(present, upstream, have);
console.log(`upstream: ${changed.size} of ${present.length} objects here are a copy of something older`);

/* The checksums the app measures a download against. A copy that does not match one is not
   worth uploading: it would be a mirror handing over bytes the app is about to refuse. */
let published = {};
try {
  const res = await fetch(`${RAW}/assets/data/mod-hashes.json`);
  if (res.ok) published = await res.json();
} catch { /* without it the copy is still a copy, just unverified */ }
const publishedFor = (objectPath) => publishedHash(published, objectPath);

/* The public address of the bucket, which is what the cache is keyed on and what the app
   downloads from. It used to come from an R2_PUBLIC_BASE secret, and on 2026-09-15 the daily
   credential check found that secret still holding an address that answered 401: every purge
   URL built from it named a host nobody downloads from. An address is not a secret, so it is
   written here, next to the code that uses it. */
const PUBLIC_BASE = 'https://cdn.dota2modmanager.com';
const replaced = [];

let copied = 0;
let skipped = 0;
let failed = 0;
let refused = 0;
let stopped = '';

for (const item of wanted) {
  if (have.has(item.path) && !changed.has(item.path)) { skipped++; continue; }
  if (copied >= LIMIT) { stopped = 'limit'; break; }
  // a new object past the budget is not worth fetching; one that replaces a copy may still fit
  if (!have.has(item.path) && used >= BUDGET) { stopped = 'budget'; continue; }

  try {
    const res = await fetch(`${RAW}/${item.path}`);
    if (!res.ok) throw new Error(`source HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    // replacing an object costs the difference, not the whole file again
    const already = have.get(item.path) || 0;
    if (!fits({ used, budget: BUDGET, already, size: body.length })) {
      stopped = 'budget';
      continue;
    }

    /* Measured against what the catalog published before it goes anywhere. A mirror that
       carries bytes the app will refuse is worse than a mirror that carries nothing: the app
       spends the whole download to find out. */
    const want = publishedFor(item.path);
    const { ok, got } = checkBody(body, want);
    if (!ok) {
      refused++;
      console.log(`not copied ${item.path}: source hashes to ${got.slice(0, 12)}, the catalog publishes ${want.slice(0, 12)}`);
      continue;
    }

    const mb = (body.length / 1024 ** 2).toFixed(1);
    const replacing = have.has(item.path);
    const verb = replacing ? 'refreshed' : 'copied';
    if (DRY) {
      console.log(`would ${verb === 'copied' ? 'copy' : 'refresh'} ${item.path} (${mb} MB)`);
    } else {
      await put(item.path, body, typeOf(item.path));
      console.log(`${verb} ${item.path} (${mb} MB)`);
    }
    used += body.length - already;
    copied++;
    // only what was replaced: an object nobody could have downloaded yet is in no cache
    if (replacing && !DRY) replaced.push(`${PUBLIC_BASE}/${item.path}`);
  } catch (e) {
    failed++;
    console.log(`skipped ${item.path}: ${e.message}`);
  }
}

if (DROP) {
  for (const key of archives) {
    if (DRY) console.log(`would delete ${key}`);
    else await r2.remove(key);
  }
  console.log(`${DRY ? 'would delete' : 'deleted'} ${archives.length} old archives`);
}

/* A replaced picture that stays cached at the edge is the stale-mirror bug from 2026-09-10 in a new
   place: the bucket holds the new bytes and everybody is still served the old ones. Until
   2026-09-15 a missing zone id or purge token only printed a line, and the purge had in fact never
   run once. Now the job goes red, which the radar reports. */
const purge = await purgeCache(replaced);
if (replaced.length && purge && (purge.skipped || purge.failed)) {
  const why = purge.skipped || `${purge.failed} refused or failed at Cloudflare`;
  console.error(`::error::${replaced.length} replaced file(s) may still be cached at the edge (${why}). The token in CLOUDFLARE_API_TOKEN needs Zone, Cache Purge on dota2modmanager.com; see .github/credentials.json`);
  process.exitCode = 1;
}

console.log(`\ncopied ${copied}, already current ${skipped}, failed ${failed}, refused ${refused}${stopped ? `, stopped on ${stopped}` : ''}`);
console.log(`bucket now ~${(used / 1024 ** 3).toFixed(2)} GB`);

/* Out of room is not an error - nothing is broken, and everything already mirrored still serves -
   but it is the mirror quietly stopping, so it goes on the run as a warning rather than as the
   last word of a green log nobody reads. */
const note = budgetNote({ used, budget: BUDGET, stopped });
console.log(note.warn ? `::warning::R2 mirror: ${note.text}` : `room: ${note.text}`);

#!/usr/bin/env node
/**
 * A copy of the mod archives that does not live on GitHub.
 *
 * The app already has a second source for the four files it needs to start: the site carries
 * those. What it had no answer for is the archives themselves. Every mirror it knows is a proxy
 * standing in front of GitHub, so the three-hour outage on 2026-08-17 meant nobody could
 * install anything at all. This puts the archives in Cloudflare R2, which is a different
 * company having a different bad day.
 *
 * What gets copied: the catalog lists every mod and the file it ships as. An object already
 * here at the size upstream reports is left alone, so a run only moves what actually changed -
 * and a mod its author has replaced does change, which this file claimed to notice and did not
 * until 2026-09-10. The free tier is 10 GB and the catalog is close to it, so there is a budget
 * - the categories people install from first go first, and the run stops when the budget is
 * spent instead of failing halfway through.
 *
 * The index written at the end is what keeps the app from guessing: without it, every install
 * of a mod that did not fit would cost a round trip to R2 and a 404 before falling back.
 *
 * No SDK. R2 speaks S3, S3 wants SigV4, and SigV4 is a hash of a canonical string: eighty lines
 * that never change, against a dependency with a supply chain.
 *
 *   node tools/r2-sync.mjs --limit 5     copy at most five archives, which is the smoke test
 *   node tools/r2-sync.mjs --budget 9    stop at nine gigabytes in the bucket
 *   node tools/r2-sync.mjs --dry         say what it would do and touch nothing
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
/* A cap on one archive, so a single mod cannot eat the bucket. It started at 400 MB, which
 * turned out to exclude exactly one thing: a 1.02 GB voice pack. The catalog fits in 5.6 GB,
 * there is room, and the point of the mirror is that an install works when GitHub does not -
 * including that one.
 */
const MAX_FILE = Number(flag('--max-file', '1200')) * 1024 ** 2;

/* Categories in the order they are worth having a second copy of: what somebody installs in
 * their first hour, then everything else in catalog order.
 */
const FIRST = ['heroes', 'terrains', 'shaders', 'trees', 'river', 'backgrounds', 'hero-items',
  'creeps', 'cursors', 'mega-kill', 'announcers', 'hero-sounds', 'couriers', 'wards'];

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
const rank = (id) => (FIRST.indexOf(id) < 0 ? FIRST.length : FIRST.indexOf(id));

/* tools and news are not mods people install, so the bucket does not carry them. Everything
   else comes through iterMods, which knows that five categories arrive as { groups: [...] }
   rather than as an array - the thing this file used to get wrong, and the reason 313 mods had
   never been mirrored. */
for (const { categoryId, mod } of iterMods(byCategory, { skip: ['tools', 'news'] })) {
  {
    const ref = mod?.file;
    if (typeof ref !== 'string' || !/\.(vpk|zip)$/i.test(ref)) continue;
    /* Some entries carry a whole URL rather than a file name: the catalog keeps its heaviest
       mods on Hugging Face. The key stays the shape the app asks for, so the app does not have
       to know where the original came from. */
    const absolute = /^https?:\/\//i.test(ref);
    const name = absolute ? decodeURIComponent(ref.split('/').pop()) : ref;
    wanted.push({
      path: `assets/files/${categoryId}/${name}`,
      source: absolute ? ref : null,
      rank: rank(categoryId),
    });
  }

  /* The picture as well as the archive.
   *
   * The renderer asks raw.githubusercontent for every preview directly, so a user who cannot
   * reach GitHub gets a catalog that loads and a grid of empty squares - the app looks broken
   * while working. All 1,336 of them come to about 38 MB, which is nothing beside the archives
   * and is the difference between a usable window and a blank one.
   *
   * First in the list on purpose: a picture is what somebody looks at before deciding to spend
   * 300 MB on the mod under it, and if the budget ever runs out it should run out on archives.
   */
  const preview = mod?.preview;
  if (typeof preview === 'string' && preview && !/^https?:\/\//i.test(preview)) {
    const key = preview.startsWith('assets/previews/')
      ? preview
      : `assets/previews/${categoryId}/${preview}`;
    wanted.push({ path: key, source: null, rank: -1 });
  }
}
wanted.sort((a, b) => a.rank - b.rank);
console.log(`catalog: ${wanted.length} archives`);

const have = await listBucket();
let used = [...have.values()].reduce((n, v) => n + v, 0);
console.log(`bucket: ${have.size} objects, ${(used / 1024 ** 3).toFixed(2)} GB of ${(BUDGET / 1024 ** 3).toFixed(0)} GB budget`);

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
        const res = await fetch(item.source || `${RAW}/${item.path}`, { method: 'HEAD' });
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
let tooBig = 0;
let refused = 0;
let stopped = '';
const index = [];

for (const item of wanted) {
  if (have.has(item.path) && !changed.has(item.path)) { index.push(item.path); skipped++; continue; }
  if (copied >= LIMIT) { stopped = 'limit'; break; }
  // a new object past the budget is not worth fetching; one that replaces a copy may still fit
  if (!have.has(item.path) && used >= BUDGET) { stopped = 'budget'; continue; }

  try {
    const res = await fetch(item.source || `${RAW}/${item.path}`);
    if (!res.ok) throw new Error(`source HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_FILE) { tooBig++; continue; }
    // replacing an object costs the difference, not the whole file again
    const already = have.get(item.path) || 0;
    if (!fits({ used, budget: BUDGET, already, size: body.length })) {
      stopped = 'budget';
      if (have.has(item.path)) index.push(item.path);
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
      if (have.has(item.path)) index.push(item.path);
      continue;
    }

    const mb = (body.length / 1024 ** 2).toFixed(1);
    const replacing = have.has(item.path);
    const verb = replacing ? 'refreshed' : 'copied';
    if (DRY) {
      console.log(`would ${verb === 'copied' ? 'copy' : 'refresh'} ${item.path} (${mb} MB)`);
    } else {
      await put(item.path, body, item.path.endsWith('.vpk') ? 'application/octet-stream' : 'application/zip');
      console.log(`${verb} ${item.path} (${mb} MB)`);
    }
    used += body.length - already;
    copied++;
    index.push(item.path);
    // only what was replaced: an object nobody could have downloaded yet is in no cache
    if (replacing && !DRY) replaced.push(`${PUBLIC_BASE}/${item.path}`);
  } catch (e) {
    failed++;
    console.log(`skipped ${item.path}: ${e.message}`);
  }
}

/* The list the app reads before it decides where to ask. */
if (!DRY) {
  const payload = JSON.stringify({ updated: new Date().toISOString().slice(0, 10), count: index.length, files: index.sort() });
  await put('index.json', Buffer.from(payload), 'application/json');
}

/* A replaced archive that stays cached at the edge is the stale-mirror bug from 2026-09-10 in a new
   place: the bucket holds the new bytes and everybody is still served the old ones. Until
   2026-09-15 a missing zone id or purge token only printed a line, and the purge had in fact never
   run once. Now the job goes red, which the radar reports. */
const purge = await purgeCache(replaced);
if (replaced.length && purge && (purge.skipped || purge.failed)) {
  const why = purge.skipped || `${purge.failed} refused or failed at Cloudflare`;
  console.error(`::error::${replaced.length} replaced file(s) may still be cached at the edge (${why}). The token in CLOUDFLARE_API_TOKEN needs Zone, Cache Purge on dota2modmanager.com; see .github/credentials.json`);
  process.exitCode = 1;
}

console.log(`\ncopied ${copied}, already current ${skipped}, too big ${tooBig}, failed ${failed}, refused ${refused}${stopped ? `, stopped on ${stopped}` : ''}`);
console.log(`bucket now ~${(used / 1024 ** 3).toFixed(2)} GB, index lists ${index.length} archives`);

/* Out of room is not an error - nothing is broken, and everything already mirrored still serves -
   but it is the mirror quietly stopping, so it goes on the run as a warning rather than as the
   last word of a green log nobody reads. */
const note = budgetNote({ used, budget: BUDGET, stopped });
console.log(note.warn ? `::warning::R2 mirror: ${note.text}` : `room: ${note.text}`);

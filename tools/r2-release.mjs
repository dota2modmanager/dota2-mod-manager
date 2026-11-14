#!/usr/bin/env node
/*
 * A second place to get an update from.
 *
 * The app updates itself out of GitHub Releases and nowhere else, so on 2026-08-17, when GitHub
 * was down for three hours, no copy of this app could have checked for or fetched an update.
 * Nobody noticed, because an app that fails to update looks exactly like an app. It becomes
 * visible on the day a release fixes something urgent, and by then it is too late to arrange a
 * second route.
 *
 * The pictures and the catalog already have one (tools/r2-sync.mjs). This puts the release itself
 * there too: the manifests electron-updater reads and the binaries they point at, under
 * updates/ in the same bucket, served from cdn.dota2modmanager.com.
 *
 * Only the current release is kept, and the current beta when one newer than it is out, so the
 * bucket carries about 320 MB for updates (640 with a beta) rather than 320 MB per release for
 * ever. Old versions stay on GitHub, which is where anybody looking for one goes.
 *
 * A beta shares the folder and not the names: its binaries carry -beta, and its two manifests are
 * rewritten to ask for those. The bucket also holds the mod mirror and was at 8.77 GB of the free
 * 10 GB in September 2026, so a second copy of every release was not worth 320 MB for ever.
 * tools/mirror-plan.js decides all of that and is tested; this fetches and uploads.
 *
 * --current is what release.yml and tools/release-watch.mjs run. It asks GitHub which release and
 * which beta are out and puts the folder in that state, whatever state it was in: until 2026-09-26
 * each run published one version, so a run that was skipped (2.7.1, 2.8.0-beta.1) left the mirror
 * behind until the next release, and nothing ran it again. --check only reads what the mirror
 * serves and compares it with GitHub, by version and by size, which a HEAD request answering 200
 * never did: an old latest.yml answers 200 too.
 *
 * Usage: node tools/r2-release.mjs --current [--dry]   the mirror as it has to stand now
 *        node tools/r2-release.mjs --check             does it stand that way (no credentials)
 *        node tools/r2-release.mjs <version> [--dry]   one version, e.g. 2.6.5 or 2.7.0-beta.1
 */
import { createRequire } from 'node:module';
import { createR2 } from './r2-client.js';
import { releasePlan, currentPlan, retargetFeed, retargetJson, staleReleaseFiles, UPDATES } from './mirror-plan.js';

const require = createRequire(import.meta.url);
const { channelHeads, mirrorExpectation, mirrorDrift, feedVersion } = require('./release-state.js');

const REPO = 'dota2modmanager/dota2-mod-manager';
const MIRROR = 'https://cdn.dota2modmanager.com/updates/';
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A request that failed on the network or on the other side's bad minute is asked again. */
async function retry(what, fn, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      console.log(`  ${what}: ${err.message}, trying again`);
      await sleep(2000 * 4 ** (i - 1));
    }
  }
}

async function github(pathname) {
  return retry(`GitHub ${pathname}`, async () => {
    const headers = { Accept: 'application/vnd.github+json' };
    if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${REPO}/${pathname}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

async function download(url) {
  return retry(`download ${url.split('/').pop()}`, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
}

/** What the mirror serves now, for each name it has to hold: a feed's version, a binary's size. */
async function readMirror(want) {
  const seen = new Map();
  for (const w of want) {
    const url = `${MIRROR}${w.name}`;
    try {
      const res = await retry(`mirror ${w.name}`, async () => {
        const r = await fetch(url, { method: w.version ? 'GET' : 'HEAD', cache: 'no-store' });
        if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
        return r;
      });
      seen.set(w.name, {
        status: res.status,
        version: w.version && res.ok ? feedVersion(await res.text()) : null,
        size: res.ok && !w.version ? Number(res.headers.get('content-length')) : null,
      });
    } catch (err) {
      seen.set(w.name, { status: 0, error: err.message });
    }
  }
  return seen;
}

/** Which release and which beta are out, with their files. */
async function heads() {
  const found = channelHeads(await github('releases?per_page=30'));
  if (!found.stable) throw new Error('GitHub lists no published release');
  return found;
}

/** Compare the mirror with GitHub. @returns {Promise<string[]>} what is wrong */
async function check(found) {
  const want = mirrorExpectation(found);
  const drift = mirrorDrift(want, await readMirror(want));
  console.log(`the mirror has to serve ${found.stable.version}${found.beta ? ` and the beta ${found.beta.version}` : ''}`);
  for (const w of want) console.log(`  ${drift.some((d) => d.startsWith(`${w.name} `)) ? 'WRONG ' : 'ok    '} ${w.name}`);
  for (const d of drift) console.log(`::error::${d}`);
  return drift;
}

/**
 * Upload what the plan names and clear out what it does not. A binary already there at the size
 * GitHub reports is left alone without downloading it: a release tag never gets two builds, and
 * 320 MB fetched to find that out is the slowest way to learn nothing.
 */
async function publish(plan, releases) {
  const r2 = createR2();
  if (!r2.configured) throw new Error('R2 credentials are not set, so there is nowhere to publish to');
  const before = await retry('list the bucket', () => r2.list(UPDATES));
  console.log(`updates/ holds ${before.size} object(s), ${(([...before.values()].reduce((n, v) => n + v, 0)) / 1024 ** 2).toFixed(0)} MB`);
  const uploaded = new Set();
  let failed = 0;
  for (const u of plan.uploads) {
    const key = `${UPDATES}${u.name}`;
    const release = releases.get(u.version);
    const asset = release && (release.assets || []).find((a) => a.name === u.asset);
    try {
      if (!asset) throw new Error(`v${u.version} carries no ${u.asset}`);
      if (!/\.(yml|json)$/.test(u.name) && before.get(key) === asset.size) {
        uploaded.add(key);
        console.log(`already there ${u.name} (${(asset.size / 1024 ** 2).toFixed(0)} MB)`);
        continue;
      }
      let body = await download(asset.browser_download_url);
      // a beta's feed has to ask for the -beta copies of the files it names
      if (u.retarget) body = Buffer.from(retargetFeed(body.toString('utf-8')), 'utf-8');
      // a Tauri feed names its files by full address: the mirror's copy names the mirror's files
      if (u.json) body = Buffer.from(retargetJson(body.toString('utf-8'), u.json), 'utf-8');
      if (!dry) await retry(`upload ${u.name}`, () => r2.put(key, body, u.type));
      uploaded.add(key);
      console.log(`${dry ? 'would upload' : 'uploaded'} ${key} from v${u.version} (${(body.length / 1024 ** 2).toFixed(1)} MB)`);
    } catch (err) {
      failed++;
      console.log(`::warning::skipped ${u.name}: ${err.message}`);
    }
  }
  const stale = plan.keep ? [...before.keys()].filter((k) => !plan.keep.has(k)) : staleReleaseFiles([...before.keys()], uploaded, plan.beta);
  for (const key of stale) {
    if (!dry) await retry(`remove ${key}`, () => r2.remove(key));
    console.log(`${dry ? 'would remove' : 'removed'} ${key}`);
  }
  console.log(`\n${uploaded.size} of ${plan.uploads.length} files in place${failed ? `, ${failed} could not be` : ''}`);
  return { uploaded: uploaded.size, failed };
}

if (args.includes('--check')) {
  const drift = await check(await heads());
  process.exit(drift.length ? 1 : 0);
} else if (args.includes('--current')) {
  const found = await heads();
  const plan = currentPlan(found.stable.version, found.beta ? found.beta.version : null);
  const releases = new Map([found.stable, found.beta].filter(Boolean).map((r) => [r.version, r]));
  const { failed } = await publish(plan, releases);
  if (dry) process.exit(0);
  // what the mirror serves, read back through the same address the app uses
  let drift = await check(found);
  for (let i = 0; drift.length && i < 3; i++) {
    await sleep(15000);
    drift = await check(found);
  }
  process.exit(drift.length || failed ? 1 : 0);
} else {
  const version = (args.find((a) => !a.startsWith('--')) || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error('usage: node tools/r2-release.mjs --current [--dry] | --check | <version> [--dry]');
    process.exit(1);
  }
  const release = await github(`releases/tags/v${version}`);
  const plan = releasePlan(version);
  const { uploaded } = await publish(plan, new Map([[version, release]]));
  if (uploaded === 0) process.exit(1);
}

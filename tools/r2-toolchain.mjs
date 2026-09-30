#!/usr/bin/env node
/*
 * A copy of the pinned toolchain that does not share GitHub's fate.
 *
 * src/toolchain.js downloads Source 2 Viewer from its own project's GitHub release, pinned by
 * version and SHA-256, to read item icons out of the game's own files. Every mirror src/net.ts
 * knows is a proxy standing in front of GitHub, so when GitHub is down the whole chain is, and
 * the feature falls back to scraping the wiki.
 *
 * This puts the archive in the bucket the mods already live in. Safe from anywhere, and that is
 * what a pin is for: the digest lives in this project's source rather than travelling with the
 * URL, so whoever hands the bytes over cannot also decide what they should hash to. Nothing is
 * uploaded until it has been checked against that digest here as well.
 *
 * Only the pinned versions are kept, so a bumped pin leaves nothing behind.
 *
 * Usage: node tools/r2-toolchain.mjs [--dry]
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createR2 } from './r2-client.js';

const require = createRequire(import.meta.url);
const { BUILT_IN_PINS } = require('../src/toolchain.js');

const dry = process.argv.includes('--dry');
const PREFIX = 'tools/';

const r2 = createR2();
if (!r2.configured) {
  console.error('R2 credentials are not set, so there is nowhere to publish to');
  process.exit(1);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const before = await r2.list(PREFIX);
console.log(`${PREFIX} holds ${before.size} object(s)`);

const keep = new Set();
let failed = 0;

for (const [name, pin] of Object.entries(BUILT_IN_PINS)) {
  const key = `${PREFIX}${name}-${pin.version}.zip`;
  keep.add(key);

  if (before.get(key) === pin.bytes) {
    console.log(`already there ${name} ${pin.version} (${(pin.bytes / 1048576).toFixed(1)} MB)`);
    continue;
  }

  try {
    const res = await fetch(pin.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());

    /* Checked here as well as in the app. The app would refuse bad bytes anyway, but a bucket
     * that serves them turns every install into a failed download instead of a working one,
     * and nobody would know which of the two hosts went wrong. */
    const digest = sha256(body);
    if (digest !== pin.sha256) throw new Error(`hashes to ${digest}, pinned as ${pin.sha256}`);
    if (body.length !== pin.bytes) throw new Error(`${body.length} bytes, pinned as ${pin.bytes}`);

    if (!dry) await r2.put(key, body, 'application/zip');
    console.log(`${dry ? 'would upload' : 'uploaded'} ${name} ${pin.version} (${(body.length / 1048576).toFixed(1)} MB)`);
  } catch (err) {
    failed++;
    console.log(`skipped ${name} ${pin.version}: ${err.message}`);
  }
}

// a bumped pin leaves the old archive behind, and nothing asks for it again
for (const key of before.keys()) {
  if (keep.has(key)) continue;
  if (!dry) await r2.remove(key);
  console.log(`${dry ? 'would remove' : 'removed'} ${key.slice(PREFIX.length)} (no pin points at it)`);
}

if (failed) process.exitCode = 1;

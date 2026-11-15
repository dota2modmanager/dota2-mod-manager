#!/usr/bin/env node
/**
 * Throw broken files at the parsers that read other people's files, for as long as you like.
 *
 * test/vpk-fuzz.test.ts and test/safe-zip-fuzz.test.js run a few hundred cases on every push,
 * which is the right size for a gate. This is the same generators with the brakes off: give it a
 * seed and a number of iterations and leave it running. The parsers are the app's own, in Rust
 * (mm-cli parse-each); anything that panics instead of refusing, or that takes longer than the
 * budget, is written to fuzz-output/ with the seed that produced it, so it can be replayed exactly.
 *
 *   node tools/dev/fuzz-parsers.mjs                        20000 VPK cases from a random seed
 *   node tools/dev/fuzz-parsers.mjs --target zip           the same for the archive door, crates/mm-core/src/formats/safe_zip.rs
 *   node tools/dev/fuzz-parsers.mjs --seed 20260916        the same cases every time
 *   node tools/dev/fuzz-parsers.mjs --iterations 500000    a long run
 *
 * Exit code 1 means it found something. The file it wrote is the test case; add it to the test
 * the target names before fixing the parser, so the fix has proof.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(root, 'fuzz-output');
// the parsers are the app's own, in Rust, read through mm-cli parse-each (tools/dev/mm-cli.js)
const { mm, jsonFile } = require('./mm-cli.js');
const AdmZip = require('adm-zip');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const text = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SEED = arg('--seed', (Date.now() ^ (process.pid << 16)) >>> 0);
const ITERATIONS = arg('--iterations', 20000);
const BUDGET_MS = arg('--budget', 2000);
const TARGET = text('--target', 'vpk');
// cases handed to mm-cli at once: one start of it per batch, not per case
const BATCH = 1000;

/** The same xorshift the tests use, so a seed means the same bytes in all three places. */
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-fuzz-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

/* ---------- VPK: the same sample and damage as test/vpk-fuzz.test.ts ---------- */

function sampleVpk() {
  const files = {
    'materials/models/heroes/wisp/wisp_color.vtex_c': 'colour bytes',
    'panorama/images/heroes/npc_dota_hero_wisp_png.vtex_c': 'portrait',
    'root_file.txt': 'at the archive root',
  };
  const list = Object.entries(files).map(([rel, body], i) => {
    fs.writeFileSync(path.join(scratch, `sample${i}`), body);
    return [rel, `sample${i}`];
  });
  fs.writeFileSync(path.join(scratch, 'sample.json'), JSON.stringify(list));
  const out = path.join(scratch, 'sample_dir.vpk');
  mm('vpk-build', out, path.join(scratch, 'sample.json'));
  return fs.readFileSync(out);
}

/** One mutated copy: some bytes flipped past the header, sometimes cut short. */
function damageVpk(base, random) {
  let buf = Buffer.from(base);
  if (random() < 0.35) buf = buf.subarray(0, 12 + Math.floor(random() * (buf.length - 12)));
  const flips = 1 + Math.floor(random() * 4);
  for (let f = 0; f < flips && buf.length > 12; f++) {
    const at = 12 + Math.floor(random() * (buf.length - 12));
    buf[at] = Math.floor(random() * 256);
  }
  return buf;
}

/* ---------- zip: the same sample and damage as test/safe-zip-fuzz.test.js ---------- */

function sampleZip() {
  const zip = new AdmZip();
  zip.addFile('mod/pak01_dir.vpk', Buffer.from('payload '.repeat(400)));
  zip.addFile('mod/readme.txt', Buffer.from('install by hand'));
  zip.addFile('fonts/a.ttf', Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7919) % 251)));
  for (const entry of zip.getEntries()) entry.header.time = new Date(2026, 0, 1);
  return zip.toBuffer();
}

function damageZip(base, random) {
  let buf = Buffer.from(base);
  if (random() < 0.3) buf = buf.subarray(0, Math.floor(random() * buf.length));
  const flips = 1 + Math.floor(random() * 6);
  for (let f = 0; f < flips && buf.length; f++) buf[Math.floor(random() * buf.length)] = Math.floor(random() * 256);
  return buf;
}

const TARGETS = {
  vpk: { base: sampleVpk, damage: damageVpk, ext: 'vpk', test: 'test/vpk-fuzz.test.ts' },
  zip: { base: sampleZip, damage: damageZip, ext: 'zip', test: 'test/safe-zip-fuzz.test.js' },
};

const target = TARGETS[TARGET];
if (!target) {
  console.error(`--target has to be one of ${Object.keys(TARGETS).join(', ')}, not "${TARGET}"`);
  process.exit(2);
}

const random = prng(SEED);
const base = target.base();
const findings = [];
console.log(`${TARGET}: seed ${SEED}, ${ITERATIONS} iterations, budget ${BUDGET_MS}ms per call`);

/** Why a parse is a finding: it panicked, or it took longer than the budget; a refusal is not one. */
const why = (r) => (r.panic != null ? `panic: ${String(r.panic).slice(0, 120)}` : r.ms > BUDGET_MS ? `took ${r.ms}ms` : null);

for (let start = 0; start < ITERATIONS && findings.length < 20; start += BATCH) {
  const bufs = [];
  for (let i = start; i < Math.min(ITERATIONS, start + BATCH); i++) bufs.push(target.damage(base, random));
  const files = bufs.map((b, k) => { const f = path.join(scratch, `case${k}`); fs.writeFileSync(f, b); return f; });
  const rows = mm('parse-each', TARGET, jsonFile(files));
  for (const [k, row] of rows.entries()) {
    for (const r of row) {
      const w = why(r);
      if (!w) continue;
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, `${r.call}-seed${SEED}-${start + k}.${target.ext}`);
      fs.writeFileSync(file, bufs[k]);
      findings.push(`${r.call} on iteration ${start + k}: ${w} (${path.relative(root, file)})`);
    }
  }
}

for (const line of findings) console.log(`FOUND  ${line}`);
console.log(findings.length
  ? `\n${findings.length} finding(s). Add one to ${target.test}, then fix the parser.`
  : `no findings in ${ITERATIONS} iterations`);
process.exitCode = findings.length ? 1 : 0;

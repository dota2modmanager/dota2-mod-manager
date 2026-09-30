#!/usr/bin/env node
/**
 * Throw broken files at the parsers that read other people's files, for as long as you like.
 *
 * test/vpk-fuzz.test.ts and test/safe-zip-fuzz.test.js run a few hundred cases on every push,
 * which is the right size for a gate. This is the same generators with the brakes off: give it a
 * seed and a number of iterations and leave it running. Anything that escapes as a Node or
 * library error rather than one of this project's own refusals, or that takes longer than the
 * budget, is written to fuzz-output/ with the seed that produced it, so it can be replayed exactly.
 *
 *   node tools/fuzz-parsers.mjs                        20000 VPK cases from a random seed
 *   node tools/fuzz-parsers.mjs --target zip           the same for the archive door, src/safe-zip.ts
 *   node tools/fuzz-parsers.mjs --seed 20260916        the same cases every time
 *   node tools/fuzz-parsers.mjs --iterations 500000    a long run
 *
 * Exit code 1 means it found something. The file it wrote is the test case; add it to the test
 * the target names before fixing the parser, so the fix has proof.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'fuzz-output');

const { buildVpk, listVpkPaths, listVpkPathCrcs, listVpkEntries } = require('../src/vpk.ts');
const { openZip } = require('../src/safe-zip.ts');
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

/* ---------- VPK: the same sample and damage as test/vpk-fuzz.test.ts ---------- */

function sampleVpk() {
  const file = (folder, name, ext, body) => {
    const data = Buffer.from(body);
    return { ext, folder, name, data, preload: Buffer.alloc(0), crc: crc32(data) >>> 0 };
  };
  return buildVpk([
    file('materials/models/heroes/wisp', 'wisp_color', 'vtex_c', 'colour bytes'),
    file('panorama/images/heroes', 'npc_dota_hero_wisp_png', 'vtex_c', 'portrait'),
    file(' ', 'root_file', 'txt', 'at the archive root'),
  ]);
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

const ourVpkRefusal = (err) => err instanceof Error && !(err instanceof RangeError)
  && !(err instanceof TypeError) && /^VPK: /.test(String(err.message));

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

function openAndRead(buf) {
  const archive = openZip(buf, { label: 'fuzz.zip' });
  for (const f of archive.files) f.read();
}

const TARGETS = {
  vpk: {
    base: sampleVpk,
    damage: damageVpk,
    calls: [['listVpkPaths', listVpkPaths], ['listVpkPathCrcs', listVpkPathCrcs], ['listVpkEntries', listVpkEntries]],
    ours: ourVpkRefusal,
    ext: 'vpk',
    test: 'test/vpk-fuzz.test.ts',
  },
  zip: {
    base: sampleZip,
    damage: damageZip,
    calls: [['openZip', openAndRead]],
    ours: (err) => err instanceof Error && err.safeZip === true,
    ext: 'zip',
    test: 'test/safe-zip-fuzz.test.js',
  },
};

const target = TARGETS[TARGET];
if (!target) {
  console.error(`--target has to be one of ${Object.keys(TARGETS).join(', ')}, not "${TARGET}"`);
  process.exit(2);
}

/** @returns {string|null} why this input is a finding, or null if the parser behaved */
function check(fn, buf) {
  const started = Date.now();
  try {
    fn(buf);
  } catch (err) {
    if (!target.ours(err)) return `${err && err.constructor ? err.constructor.name : typeof err}: ${String(err && err.message).slice(0, 120)}`;
  }
  const took = Date.now() - started;
  return took > BUDGET_MS ? `took ${took}ms` : null;
}

const random = prng(SEED);
const base = target.base();
const findings = [];
console.log(`${TARGET}: seed ${SEED}, ${ITERATIONS} iterations, budget ${BUDGET_MS}ms per call`);

for (let i = 0; i < ITERATIONS; i++) {
  const buf = target.damage(base, random);
  for (const [name, fn] of target.calls) {
    const why = check(fn, buf);
    if (!why) continue;
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, `${name}-seed${SEED}-${i}.${target.ext}`);
    fs.writeFileSync(file, buf);
    findings.push(`${name} on iteration ${i}: ${why} (${path.relative(root, file)})`);
  }
  if (findings.length >= 20) break;
}

for (const line of findings) console.log(`FOUND  ${line}`);
console.log(findings.length
  ? `\n${findings.length} finding(s). Add one to ${target.test}, then fix the parser.`
  : `no findings in ${ITERATIONS} iterations`);
process.exitCode = findings.length ? 1 : 0;

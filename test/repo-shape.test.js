'use strict';
/* Two cheap guards on the shape of the repository.
   A source file stays under a thousand lines: past that nobody reads it whole, and a change in it
   lands next to code it never meant to touch. The few files already over are held where they are
   today, so they can shrink but not grow.
   A link in a document people open first goes somewhere: the folders were rearranged on
   2026-11-15, and a README pointing at a file that moved is the first thing a visitor clicks. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean);

const LIMIT = 1000;
const HELD = {
  'crates/mm-core/src/formats/kv3.rs': 1413,
  'renderer/styles/catalog.css': 1121,
  'crates/mm-core/src/models/hero_preview.rs': 1037,
};

test('no source file grows past a thousand lines', () => {
  const source = /^(crates|src-tauri|renderer|tools|test)\/.*\.(rs|ts|tsx|js|mjs|cjs|css)$/;
  const over = [];
  for (const f of tracked) {
    if (!source.test(f) || f.includes('/vendor/')) continue;
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').length - 1;
    const cap = HELD[f] ?? LIMIT;
    if (lines > cap) over.push(`${f}: ${lines} lines, the cap is ${cap}`);
  }
  assert.deepEqual(over, [], 'split the file, or move the part that grew into its own module');
});

test('every relative link in the front-door documents points at a file that exists', () => {
  const docs = tracked.filter((f) => /^(README[^/]*|CONTRIBUTING|SECURITY|AGENTS)\.md$/.test(f) || /^(docs|\.github)\/[^/]*\.md$/.test(f) || /^docs\/.*\.md$/.test(f));
  const known = new Set(tracked);
  const dirs = new Set(tracked.flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  const broken = [];
  for (const f of docs) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const link = m[1];
      if (/^(https?:|mailto:|#|\/)/.test(link)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), decodeURI(link.split('#')[0]))).replace(/\/$/, '');
      if (!target || target === '.') continue;
      if (!known.has(target) && !dirs.has(target)) broken.push(`${f}: ${link}`);
    }
  }
  assert.deepEqual(broken, []);
});

// A path written as code is a link too, only one nothing clicks: when the file it names went (a
// module ported, a test removed), the sentence kept pointing at it. DECISIONS.md is a record of
// what was, and names files that are gone on purpose; the changelogs and incidents likewise.
test('every repository path written as code in the documents is a file that exists', () => {
  const docs = tracked.filter((f) => f.endsWith('.md') && !/^(vendor|site\/src\/content)\//.test(f) && !/(^|\/)(CHANGELOG[^/]*|DECISIONS)\.md$/.test(f) && !f.startsWith('docs/incidents/'));
  const known = new Set(tracked);
  const dirs = new Set(tracked.flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  const gone = [];
  for (const f of docs) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/`((?:crates|src-tauri|src|renderer|tools|test|docs|\.github|site)\/[A-Za-z0-9_./-]*[A-Za-z0-9_])`/g)) {
      const p = m[1].replace(/\/$/, '');
      if (/[*<]/.test(p)) continue;
      if (!known.has(p) && !dirs.has(p)) gone.push(`${f}: ${p}`);
    }
  }
  assert.deepEqual(gone, []);
});

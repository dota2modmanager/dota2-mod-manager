#!/usr/bin/env node
/**
 * Type checking that is allowed to get better and not worse.
 *
 * `tsc --checkJs` reads the JSDoc this project already carries and says where the code and its own
 * documentation disagree. On the first run it found a require that had never resolved (two handlers
 * answered every call with "Cannot find module") and three pieces of JSDoc describing a different
 * function than the one below them. Those are fixed. What is left is sixty-odd places where a
 * factory's `@param` lists half the properties it is handed, or an object literal is filled in
 * later, and fixing them all at once would be one unreviewable change across fifteen files.
 *
 * So the count is written down per file, and this refuses a run where any file has more errors than
 * its line in the baseline, or where a file appears that had none. Fewer is always fine, and the
 * message says which file improved and asks for the baseline to be lowered. It is the same shape as
 * the coverage floor in package.json: a line that only moves one way.
 *
 *   node tools/typecheck.mjs            check against .github/typecheck-baseline.json
 *   node tools/typecheck.mjs --update   write what is there now as the new baseline
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(root, '.github', 'typecheck-baseline.json');

/**
 * tsc's own output, as counts per file.
 * A line looks like: src/foo.js(12,34): error TS2339: Property 'x' does not exist...
 * Windows prints the same path with backslashes, so they are flattened to one shape.
 * @param {string} output
 * @returns {{ total: number, files: Record<string, number> }}
 */
export function parse(output) {
  const files = {};
  let total = 0;
  for (const line of String(output).split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error TS\d+:/.exec(line);
    if (!m) continue;
    const file = m[1].replace(/\\/g, '/');
    files[file] = (files[file] || 0) + 1;
    total++;
  }
  return { total, files };
}

/**
 * What changed against the baseline.
 * @param {{ files: Record<string, number> }} baseline
 * @param {{ files: Record<string, number> }} now
 * @returns {{ worse: string[], better: string[], gone: string[] }}
 */
export function compare(baseline, now) {
  const was = baseline.files || {};
  const has = now.files || {};
  const worse = [];
  const better = [];
  const gone = [];
  for (const file of Object.keys(has).sort()) {
    const before = was[file] || 0;
    if (has[file] > before) worse.push(`${file}: ${has[file]} errors, ${before} allowed`);
    else if (has[file] < before) better.push(`${file}: ${has[file]}, was ${before}`);
  }
  for (const file of Object.keys(was).sort()) {
    if (!has[file]) gone.push(`${file}: clean, was ${was[file]}`);
  }
  return { worse, better, gone };
}

/**
 * Run tsc through the local install over every project, and hand back whatever it printed.
 * tsconfig.json is the two preload bridges, the JavaScript left, checked through JSDoc;
 * src/tsconfig.json is the main process, test/tsconfig.json the tests written in TypeScript, and
 * renderer/tsconfig.json the window's TypeScript, all three strict and with nothing in the
 * baseline, so any error there is a file that appeared with errors and fails the run.
 */
function runTsc() {
  const tsc = require.resolve('typescript/bin/tsc');
  let out = '';
  for (const project of ['tsconfig.json', 'src/tsconfig.json', 'test/tsconfig.json', 'renderer/tsconfig.json']) {
    try {
      execFileSync(process.execPath, [tsc, '-p', project], { cwd: root, encoding: 'utf8' });
    } catch (err) {
      // tsc exits non-zero when it found something; that is the normal path here
      if (err.stdout == null && err.stderr == null) throw err;
      out += `${err.stdout || ''}${err.stderr || ''}`;
    }
  }
  return out;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const now = parse(runTsc());

  if (process.argv.includes('--update')) {
    const body = {
      _why: 'How many type errors each file still has. tools/typecheck.mjs refuses a run where a file '
        + 'has more than its number here, or where a file appears that had none. Lower it by fixing '
        + 'errors and running: node tools/typecheck.mjs --update. Never raise a line to make a run pass.',
      measured: new Date().toISOString().slice(0, 10),
      total: now.total,
      files: Object.fromEntries(Object.keys(now.files).sort().map((f) => [f, now.files[f]])),
    };
    fs.writeFileSync(BASELINE, `${JSON.stringify(body, null, 2)}\n`);
    console.log(`baseline written: ${now.total} error(s) across ${Object.keys(now.files).length} file(s)`);
    process.exit(0);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const { worse, better, gone } = compare(baseline, now);

  for (const line of gone) console.log(`clean   ${line}`);
  for (const line of better) console.log(`better  ${line}`);
  for (const line of worse) console.log(`WORSE   ${line}`);

  if (worse.length) {
    console.error(`\ntype errors went up in ${worse.length} file(s). Run "npx tsc -p tsconfig.json" to read them.`);
    process.exit(1);
  }
  if (better.length || gone.length) {
    console.log('\nBetter than the baseline. Lock it in: node tools/typecheck.mjs --update');
  }
  console.log(`type check: ${now.total} known error(s), none new`);
}

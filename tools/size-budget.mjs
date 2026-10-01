#!/usr/bin/env node
/**
 * The big files may get smaller. They may not get bigger.
 *
 * Five files carry 7 155 lines between them while the median module in src/ is 171:
 * src/installer.js, renderer/views/catalog.js, renderer/views/library.js, main.js and src/vpk.js.
 * That is not a style, it is five outliers, and every one of them got there a hundred lines at a
 * time with nobody deciding to.
 *
 * So each of them has its size written down, and a run fails when one grows. Any file that is not
 * on the list fails when it crosses 300 lines, which is how a new outlier would have to announce
 * itself rather than arrive. The mark was 800 until 2026-09-27, when the window started moving to
 * one component per file: every file already past 300 then was written down at the size it had. `--update` writes the measurements back, and refuses to raise a
 * number: the only way a budget goes up is by editing the file by hand and saying why in the
 * commit, which is exactly the conversation that never happened the first five times.
 *
 * This is a budget, not a plan: splitting these files is separate work, and each split shows up
 * here as a number going down.
 *
 *   node tools/size-budget.mjs            check
 *   node tools/size-budget.mjs --update   write the measurements back (never upward)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET = path.join(root, '.github', 'size-budget.json');
/** Where a file stops being ordinary: one component, one job. */
export const WATCH_AT = 300;

/** The app's own code: what ships in the build, plus the two preload bridges. */
export function appFiles(readdir = fs.readdirSync, exists = fs.existsSync) {
  const out = ['preload.js', 'preload-uninstall.js'];
  // every source file under src/ and renderer/, at any depth and in either language the window is
  // written in; renderer/public holds pictures, and nothing in it is code; a .d.ts ships nothing
  const walk = (dir) => {
    for (const e of readdir(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (rel !== 'renderer/public') walk(rel);
      } else if (/\.[cm]?[jt]sx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(rel);
    }
  };
  for (const dir of ['src', 'renderer']) if (exists(path.join(root, dir))) walk(dir);
  return out.filter((f) => exists(path.join(root, f))).sort();
}

/** Lines in a file, counted the way wc -l does. */
export function countLines(text) {
  if (!text) return 0;
  const lines = text.split('\n');
  // a trailing newline does not start a line
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/**
 * What is over budget now.
 * @param {Record<string, number>} budget  file -> lines it is allowed
 * @param {Record<string, number>} now     file -> lines it has
 * @param {number} watchAt
 */
export function compare(budget, now, watchAt = WATCH_AT) {
  const over = [];
  const shrunk = [];
  const gone = [];
  for (const [file, lines] of Object.entries(now)) {
    const allowed = budget[file];
    if (allowed === undefined) {
      if (lines > watchAt) {
        over.push(`${file}: ${lines} lines, over the ${watchAt}-line watch mark and not in the budget`);
      }
      continue;
    }
    if (lines > allowed) over.push(`${file}: ${lines} lines, budget ${allowed}`);
    else if (lines < allowed) shrunk.push(`${file}: ${lines} lines, budget ${allowed}`);
  }
  for (const file of Object.keys(budget)) {
    if (now[file] === undefined) gone.push(`${file}: no longer there, budget ${budget[file]}`);
  }
  return { over, shrunk, gone };
}

/** Measurements to write, refusing to raise any existing number. */
export function tighten(budget, now) {
  const next = {};
  const refused = [];
  for (const [file, lines] of Object.entries(now)) {
    const allowed = budget[file];
    if (allowed === undefined) {
      if (lines > WATCH_AT) next[file] = lines;
      continue;
    }
    if (lines > allowed) { next[file] = allowed; refused.push(`${file}: ${lines} lines, budget stays ${allowed}`); }
    else next[file] = lines;
  }
  return { next, refused };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const now = {};
  for (const file of appFiles()) now[file] = countLines(fs.readFileSync(path.join(root, file), 'utf8'));

  const budget = (() => {
    try { return JSON.parse(fs.readFileSync(BUDGET, 'utf8')).files; } catch { return {}; }
  })();

  if (process.argv.includes('--update')) {
    const { next, refused } = tighten(budget, now);
    for (const line of refused) console.log(`REFUSED ${line}`);
    fs.writeFileSync(BUDGET, `${JSON.stringify({
      _why: 'Lines each of the largest files is allowed. tools/size-budget.mjs fails a run where one '
        + `grows, and where a file that is not listed crosses ${WATCH_AT} lines. --update writes `
        + 'measurements back but never raises a number: raising one means editing this file by hand '
        + 'and saying why. Splitting these files shows up here as a number going down.',
      measured: new Date().toISOString().slice(0, 10),
      watchAt: WATCH_AT,
      files: Object.fromEntries(Object.keys(next).sort().map((f) => [f, next[f]])),
    }, null, 2)}\n`);
    console.log(`budget written: ${Object.keys(next).length} file(s) watched${refused.length ? `, ${refused.length} kept where they were` : ''}`);
    process.exit(0);
  }

  const { over, shrunk, gone } = compare(budget, now);
  for (const line of shrunk) console.log(`smaller ${line}`);
  for (const line of gone) console.log(`gone    ${line}`);
  for (const line of over) console.log(`OVER    ${line}`);

  if (over.length) {
    console.error(`\n${over.length} file(s) over budget. Split something, or say in the commit why the budget moves.`);
    process.exit(1);
  }
  const watched = Object.keys(budget).length;
  console.log(`size budget: ${watched} watched file(s) within budget, nothing else over ${WATCH_AT} lines`);
  if (shrunk.length) console.log('Smaller than the budget. Lock it in: node tools/size-budget.mjs --update');
}

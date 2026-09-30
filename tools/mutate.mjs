#!/usr/bin/env node
/**
 * Break the code on purpose, and fail when no test notices.
 *
 * A green suite says the tests ran. It does not say they would catch anything. On 2026-09-16 a
 * fresh test asserting that a rebuilt pack keeps its slot passed against code that allocated a
 * new slot every time: removePackDeployed frees the old slot before the allocator runs, so
 * re-allocating handed the same number back and the assertion held either way. Green test,
 * unguarded promise, and only a deliberate breakage told the two apart.
 *
 * So each promise worth keeping gets a mutant in .github/mutants.json: a small edit that breaks
 * it, anchored to the function it belongs to, and the test file that should go red. A mutant
 * that survives means the test guarding that promise proves nothing.
 *
 * A mutant that no longer applies is the worse case, and the reason this is a tool rather than a
 * script somebody ran once: the code moves, the edit stops matching, and the check goes on
 * passing against nothing. The first run of this had two of seven quietly not applying. So a
 * mutant that cannot be applied fails the run exactly like one that survived, and test/mutate.test.js
 * holds every mutant against today's source on every push, without running any of them.
 *
 * Putting the file back is checked rather than assumed. On 2026-09-16 a run reported every
 * mutant caught and left one of them in src/installer.js: the write that should have restored it
 * did not take, and each later mutant on that file then read the broken copy as its own original
 * and faithfully put THAT back. Nothing said a word, and the branch was one push away from
 * carrying a deliberately broken installer. So a restore is read back and compared, a file that
 * changed under the run stops it on the spot, and the end of the run asks git whether anything
 * was left behind.
 *
 *   node tools/mutate.mjs             every mutant
 *   node tools/mutate.mjs deployPack  only those whose name or file matches
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG = path.join(root, '.github', 'mutants.json');

/**
 * Apply one mutation to a file's text.
 *
 * Every mutant is anchored to the function it belongs to and applied to the first match after
 * that anchor: `this.allocatePak(this.usedPakNames(), false)` appears in three places in
 * src/installer.js, and mutating the wrong one tests a different feature while claiming to test
 * this one.
 *
 * @param {string} src  the file as it is today
 * @param {{anchor: string, from?: string, lineStartsWith?: string, to: string}} m
 * @returns {{out: string, err?: undefined} | {err: string, out?: undefined}}
 */
export function apply(src, m) {
  const at = src.indexOf(m.anchor);
  if (at < 0) return { err: `anchor is gone: ${m.anchor}` };
  if (src.indexOf(m.anchor, at + 1) >= 0) return { err: `anchor is not unique: ${m.anchor}` };

  if (m.lineStartsWith) {
    const hit = src.indexOf(m.lineStartsWith, at);
    if (hit < 0) return { err: `no line starting "${m.lineStartsWith}" after the anchor` };
    const from = src.lastIndexOf('\n', hit) + 1;
    const end = src.indexOf('\n', hit);
    return { out: src.slice(0, from) + m.to + src.slice(end) };
  }

  const hit = src.indexOf(m.from, at);
  if (hit < 0) return { err: `text is gone after the anchor: ${m.from}` };
  return { out: src.slice(0, hit) + m.to + src.slice(hit + m.from.length) };
}

/**
 * What the run concluded. Anything other than "caught" is a failure: a surviving mutant is an
 * unguarded promise, and one that could not be applied is a check that has stopped checking.
 * @param {Array<{name: string, outcome: string}>} results
 */
export function verdict(results) {
  const escaped = results.filter((r) => r.outcome !== 'caught');
  return { ok: escaped.length === 0, escaped };
}

/** The mutants, with the config's own shape checked rather than assumed. */
export function readMutants(file = CONFIG) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = parsed.mutants || [];
  for (const m of list) {
    const has = m.from ? 'from' : 'lineStartsWith';
    if (!m.name || !m.file || !m.anchor || !m[has] || typeof m.to !== 'string' || !m.test) {
      throw new Error(`a mutant is missing fields: ${JSON.stringify(m).slice(0, 120)}`);
    }
  }
  return list;
}

/* ---------- running them ---------- */

/** Files with uncommitted changes, so a run cannot rewrite work it would have to put back. */
function dirty(files) {
  const r = spawnSync('git', ['status', '--porcelain', '--', ...files], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return []; // not a git checkout: nothing to protect
  return r.stdout.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
}

/**
 * Put a file back, and prove it went back. A write that does not take leaves a mutant on disk
 * and every later mutant on that file reads the broken copy as its original, so the one thing
 * this must not do is trust the write.
 *
 * @param {string} abs        the file
 * @param {string} original   what it held before the mutant
 * @param {{readFileSync: Function, writeFileSync: Function}} [io]  the filesystem, injectable for the test
 * @returns {boolean} whether the file now holds the original again
 */
export function restoreFile(abs, original, io = fs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      io.writeFileSync(abs, original);
      if (io.readFileSync(abs, 'utf8') === original) return true;
    } catch { /* locked, or gone: the next attempt says whether it came back */ }
  }
  return false;
}

/** How to say a file is still broken, in the one form that fixes it. */
function restoreByHand(files) {
  return `Restore it before anything else:  git checkout -- ${files.join(' ')}`;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const filter = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const mutants = readMutants().filter((m) => !filter || m.name.includes(filter) || m.file.includes(filter));
  if (!mutants.length) {
    console.error(filter ? `no mutant matches "${filter}"` : 'no mutants are configured');
    process.exit(1);
  }

  /* Every source is restored from a copy held here, but a run that is killed between the write
     and the restore leaves the mutant on disk. Uncommitted work in those files would then be
     unrecoverable, so it is not put at risk in the first place. */
  const blocked = dirty([...new Set(mutants.map((m) => m.file))]);
  if (blocked.length) {
    console.error(`commit or stash these first, a mutation run rewrites them: ${blocked.join(', ')}`);
    process.exit(1);
  }

  const results = [];
  // what each file held when this run started, so a restore that did not take is caught at the
  // next mutant on that file rather than baked into it as an "original"
  const pristine = new Map();
  for (const m of mutants) {
    const abs = path.join(root, m.file);
    const original = fs.readFileSync(abs, 'utf8');
    if (!pristine.has(m.file)) pristine.set(m.file, original);
    else if (pristine.get(m.file) !== original) {
      console.error(`\n${m.file} is not what it was when this run started: an earlier mutant is still in it.`);
      console.error(restoreByHand([m.file]));
      process.exit(1);
    }
    const { out, err } = apply(original, m);
    if (err) {
      console.log(`NOT APPLIED  ${m.name}\n             ${err}`);
      results.push({ name: m.name, outcome: 'not-applied' });
      continue;
    }
    try {
      fs.writeFileSync(abs, out);
      const r = spawnSync('node', ['--test', m.test], { cwd: root, encoding: 'utf8' });
      const output = r.stdout + r.stderr;
      // A mutant that does not even parse proves nothing about the tests
      const broken = /SyntaxError|is not defined/.test(output) && r.status !== 0;
      const failed = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
      if (broken) {
        console.log(`INVALID      ${m.name}\n             the mutant does not run, so the tests cannot judge it`);
        results.push({ name: m.name, outcome: 'invalid' });
      } else if (r.status !== 0) {
        console.log(`caught       ${m.name}\n             by: ${failed.join('; ') || `${m.test} went red`}`);
        results.push({ name: m.name, outcome: 'caught' });
      } else {
        console.log(`SURVIVED     ${m.name}\n             ${m.test} passed with the promise broken`);
        results.push({ name: m.name, outcome: 'survived' });
      }
    } finally {
      if (!restoreFile(abs, original)) {
        console.error(`\n${m.file} could not be put back: it still holds the mutant "${m.name}".`);
        console.error(restoreByHand([m.file]));
        process.exit(1);
      }
    }
  }

  // and ask git, because the check above only sees the files this run touched on purpose
  const leftBehind = dirty([...pristine.keys()]);
  if (leftBehind.length) {
    console.error(`\nthese did not come back: ${leftBehind.join(', ')}`);
    console.error(restoreByHand(leftBehind));
    process.exit(1);
  }

  const { ok, escaped } = verdict(results);
  if (ok) {
    console.log(`\nall ${results.length} mutants caught`);
    process.exit(0);
  }
  console.error(`\n${escaped.length} of ${results.length} got past the tests: ${escaped.map((e) => e.name).join(', ')}`);
  console.error('Write the test that would have noticed, or say in the commit why the promise is not worth guarding.');
  process.exit(1);
}

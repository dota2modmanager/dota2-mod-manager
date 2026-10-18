#!/usr/bin/env node
/**
 * A pull request that fixes something changes a test too, or says why it cannot.
 *
 * Between 2026-08-15 and 2026-09-15, 41 commits on main described a fix and 19 of them touched no
 * test at all. That is how the same class of bug came back: 2.6.5 and 2.6.6 shipped with Install
 * dead after a refactor, and the fix that followed did not add the test that would have caught
 * the next one, so 2.6.7 found a second instance of it by hand.
 *
 * The rule is deliberately small. A change counts as a fix when it carries the label bug or
 * regression, or when its title or a commit subject says fix, fixes, fixed, regression, broke or
 * broken. Such a change must modify something under test/ (or site/test/, the site's own browser
 * tests, for a fix to the site), or carry a line
 *
 *   No-Test-Because: <reason>
 *
 * in a commit message or the pull request description. Typos in a sentence are real fixes with
 * nothing to test, and the trailer is for them; the radar lists every one used, so the escape
 * hatch stays visible instead of becoming a habit. Dependabot's pull requests are dependency bumps
 * and are left alone.
 *
 * Run by .github/workflows/pull-request.yml with the pull request's base and head.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIX_WORDS = /\b(fix(es|ed)?|regression|broke|broken)\b/i;
export const FIX_LABELS = ['bug', 'regression'];
export const TRAILER = /^No-Test-Because:[ \t]*\S.*$/im;

export function judge({ title = '', body = '', labels = [], author = '', commits = [], files = [] }) {
  if (/^dependabot(\[bot\])?$/.test(author)) return { ok: true, reason: 'a dependency update from Dependabot' };

  const labelled = labels.filter((l) => FIX_LABELS.includes(l));
  const subjects = commits.map((c) => String(c.message || '').split('\n')[0]);
  const worded = [title, ...subjects].filter((s) => FIX_WORDS.test(s));
  const isFix = labelled.length > 0 || worded.length > 0;
  if (!isFix) return { ok: true, reason: 'not described as a fix' };

  const tests = files.filter((f) => f.startsWith('test/') || f.startsWith('site/test/'));
  if (tests.length) return { ok: true, reason: `a fix, and it changes ${tests.length} test file${tests.length === 1 ? '' : 's'}` };

  const trailer = [body, ...commits.map((c) => c.message)].map((t) => TRAILER.exec(String(t || ''))).find(Boolean);
  if (trailer) return { ok: true, reason: `a fix with no test, and it says why: ${trailer[0].replace(/^No-Test-Because:\s*/i, '')}` };

  const why = labelled.length ? `it is labelled ${labelled.join(', ')}` : `"${worded[0]}" describes a fix`;
  return {
    ok: false,
    reason: `${why}, and nothing under test/ or site/test/ changed. Add the test that fails without this change, or put "No-Test-Because: <reason>" in a commit message or the pull request description.`,
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { BASE, HEAD, TITLE = '', BODY = '', LABELS = '', AUTHOR = '' } = process.env;
  if (!BASE || !HEAD) {
    console.error('BASE and HEAD must be the pull request base and head commits');
    process.exit(64);
  }
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  const commits = git('log', '--format=%B%x00', `${BASE}..${HEAD}`).split('\0').map((m) => m.trim()).filter(Boolean).map((message) => ({ message }));
  const files = git('diff', '--name-only', `${BASE}...${HEAD}`).split('\n').map((f) => f.trim()).filter(Boolean);
  const result = judge({ title: TITLE, body: BODY, labels: LABELS.split(',').filter(Boolean), author: AUTHOR, commits, files });
  if (result.ok) {
    console.log(`ok: ${result.reason}`);
  } else {
    console.error(`::error::${result.reason}`);
    process.exitCode = 1;
  }
}

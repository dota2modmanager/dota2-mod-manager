#!/usr/bin/env node
/**
 * A release builds only a commit that has already passed its checks.
 *
 * Until 2026-09-15 release.yml built whatever a tag pointed at. Tests ran on the same push, in a
 * different workflow, and nothing connected the two: 2.6.11 was tagged on a commit whose suite was
 * red, and the installer, the AppImage and the update feed all went out while the Tests run was
 * still failing next to them. On 2026-09-10 the same gap let four releases out in one evening.
 *
 * So the first job of release.yml runs this. It reads the check runs GitHub recorded for the
 * tagged commit, waits while any required one is still running or has not started, and fails the
 * moment one of them fails. The list of required checks lives in .github/required-checks.json,
 * the same file the branch ruleset is kept in line with, so "what a merge needs" and "what a
 * release needs" cannot drift apart by being written down twice.
 *
 * Before any of that it asks whether the commit is on main at all. A change reaches main only
 * through a pull request and the merge queue, and checks also run on pull request branches, so a
 * green commit is not yet a merged one. Anybody who can push a tag could otherwise ship a branch
 * that never went through the queue.
 *
 * Usage:
 *   GH_TOKEN=... GITHUB_REPOSITORY=owner/repo node tools/release-gate.mjs <sha>
 *   node tools/release-gate.mjs <sha> --once      # one look, no waiting (exit 0 pass, 1 fail, 2 still waiting)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** The checks a release waits for, from the one file both gates read. */
export function requiredChecks(kind = 'release') {
  const list = JSON.parse(fs.readFileSync(path.join(root, '.github', 'required-checks.json'), 'utf8'))[kind];
  if (!Array.isArray(list) || !list.length) throw new Error(`.github/required-checks.json has no "${kind}" list`);
  return list;
}

/**
 * Where a commit stands against a list of required checks.
 *
 * Only runs made by GitHub Actions count: a check with the same name from some other app says
 * nothing about this repository's workflows. When a check ran more than once (a re-run), the
 * newest run is the answer. A check passes only on "success": "skipped" or "neutral" on a
 * required check means it did not actually run, and a release is not the place to find out why.
 */
export function evaluate(checkRuns, required) {
  const latest = new Map();
  for (const run of checkRuns || []) {
    if (run.app && run.app.slug && run.app.slug !== 'github-actions') continue;
    const prev = latest.get(run.name);
    if (!prev || run.id > prev.id) latest.set(run.name, run);
  }
  const out = { state: 'pass', passed: [], pending: [], missing: [], failed: [] };
  for (const name of required) {
    const run = latest.get(name);
    if (!run) out.missing.push(name);
    else if (run.status !== 'completed') out.pending.push(name);
    else if (run.conclusion === 'success') out.passed.push(name);
    else out.failed.push(`${name} (${run.conclusion})`);
  }
  if (out.failed.length) out.state = 'fail';
  else if (out.pending.length || out.missing.length) out.state = 'wait';
  return out;
}

/** A one-line account of the state, for the log. */
export function describe(result) {
  const parts = [];
  if (result.failed.length) parts.push(`failed: ${result.failed.join(', ')}`);
  if (result.pending.length) parts.push(`running: ${result.pending.join(', ')}`);
  if (result.missing.length) parts.push(`not started: ${result.missing.join(', ')}`);
  if (result.passed.length) parts.push(`passed: ${result.passed.join(', ')}`);
  return `${result.state}  ${parts.join('; ')}`;
}

/**
 * Whether a commit is on main, from the status GitHub's compare API gives for main...sha.
 * "identical" is main's own head and "behind" is a commit main already contains. "ahead" and
 * "diverged" carry something main does not have, which is a branch, not a release.
 */
export function onMain(status) {
  return status === 'identical' || status === 'behind';
}

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dota2-mod-manager-release-gate',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** GitHub's word on where a commit stands against main. */
export async function compareWithMain(repo, sha, token, get = fetch) {
  const res = await get(`https://api.github.com/repos/${repo}/compare/main...${sha}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`compare main...${sha}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return (await res.json()).status;
}

async function checkRunsFor(repo, sha, token) {
  const runs = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`, {
      headers: headers(token),
    });
    if (!res.ok) throw new Error(`check runs for ${sha}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    const body = await res.json();
    runs.push(...(body.check_runs || []));
    if (runs.length >= (body.total_count || 0) || !(body.check_runs || []).length) break;
  }
  return runs;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const sha = process.argv[2];
  const once = process.argv.includes('--once');
  const repo = process.env.GITHUB_REPOSITORY || 'dota2modmanager/dota2-mod-manager';
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const timeoutMs = Number(process.env.GATE_TIMEOUT_MINUTES || 60) * 60000;
  const pollMs = Number(process.env.GATE_POLL_SECONDS || 30) * 1000;
  if (!/^[0-9a-f]{7,40}$/.test(sha || '')) {
    console.error('usage: node tools/release-gate.mjs <commit sha> [--once]');
    process.exit(64);
  }
  const where = await compareWithMain(repo, sha, token);
  if (!onMain(where)) {
    console.error(`::error::${sha.slice(0, 7)} is not on main (compare says "${where}"). A release is built only from a commit that reached main through an approved pull request: merge it, then tag the merged commit.`);
    process.exit(1);
  }
  console.log(`${sha.slice(0, 7)} is on main`);
  const required = requiredChecks('release');
  const started = Date.now();
  for (;;) {
    const result = evaluate(await checkRunsFor(repo, sha, token), required);
    console.log(describe(result));
    if (result.state === 'pass') {
      console.log(`${sha.slice(0, 7)} passed every check a release needs`);
      break;
    }
    if (result.state === 'fail') {
      console.error(`::error::${sha.slice(0, 7)} did not pass ${result.failed.join(', ')}. Nothing is built from it: fix main, then tag the commit that passes.`);
      process.exitCode = 1;
      break;
    }
    if (once) {
      process.exitCode = 2;
      break;
    }
    if (Date.now() - started > timeoutMs) {
      console.error(`::error::after ${Math.round(timeoutMs / 60000)} minutes still waiting on ${[...result.pending, ...result.missing].join(', ')}. A check that never starts is usually a workflow whose paths filter this commit did not match.`);
      process.exitCode = 1;
      break;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

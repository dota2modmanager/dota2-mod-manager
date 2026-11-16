#!/usr/bin/env node
/*
 * After a release: is everything that should have happened, done - and if not, do it.
 *
 * release.yml publishes, then three jobs finish the job: the update mirror, the Discord post and
 * the antivirus check. On 2.7.1 and 2.8.0-beta.1 a failed step skipped all three, the release was
 * public, the run was red, and the mirror sat on 2.7.0 for days while nobody re-ran anything. A red
 * run is a thing somebody has to notice. This notices instead, every few hours and right after
 * every release run, and puts right what it can:
 *
 *   - the mirror: compared with GitHub by version and by size, and brought up to date when it is
 *     behind (tools/release/r2-release.mjs --current);
 *   - the Discord post: sent when the release run did not send it, and marked in the release notes
 *     so it is sent once;
 *   - the antivirus check: asked for when nothing has run it since the release went out.
 *
 * What it cannot put right it says, and the run goes red: a published release missing a file (an
 * immutable release cannot gain one; the next version has to carry it), a post Discord keeps
 * refusing, a check that ran and wrote nothing.
 *
 * Releases published before WATCH_FROM are only held to the mirror: 2.7.1 went out without a
 * Discord post on purpose, and announcing it now would be news three days late.
 *
 * Usage: node tools/release/release-watch.mjs            look, change nothing
 *        node tools/release/release-watch.mjs --repair   look, and put right what can be
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { channelHeads, missingAssets, discordPayload, ANNOUNCED, watched, announced, scanned } = require('./release-state.js');

const REPO = process.env.GITHUB_REPOSITORY || 'dota2modmanager/dota2-mod-manager';
const repair = process.argv.includes('--repair');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, { method = 'GET', body } = {}) {
  for (let i = 1; ; i++) {
    const headers = { Accept: 'application/vnd.github+json' };
    if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`https://api.github.com/repos/${REPO}/${pathname}`, { method, headers, body: body && JSON.stringify(body) });
    if (res.ok) return res.status === 204 ? null : res.json();
    if (i >= 4 || res.status < 500) throw new Error(`${method} ${pathname}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    await sleep(3000 * i);
  }
}

/** The Release run for a tag, newest first, or null. */
async function releaseRun(tag) {
  const runs = await api('actions/workflows/release.yml/runs?per_page=30');
  return (runs.workflow_runs || []).find((r) => r.head_branch === tag) || null;
}

async function postToDiscord(release) {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) throw new Error('DISCORD_WEBHOOK_URL is not set');
  const payload = discordPayload({ name: release.name || release.tag_name, url: release.html_url, notes: release.body });
  for (let i = 1; ; i++) {
    const res = await fetch(`${hook}?wait=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) return;
    if (i >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`Discord answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await sleep(5000 * i);
  }
}

const problems = [];
const done = [];
const say = (s) => console.log(s);

const releases = await api('releases?per_page=30');
const { stable, beta } = channelHeads(releases);
if (!stable) {
  problems.push('GitHub lists no published release');
} else {
  say(`release ${stable.tag_name}${beta ? `, beta ${beta.tag_name}` : ', no newer beta'}`);

  // 1. every file on the releases the updater reads
  for (const rel of [stable, beta].filter(watched)) {
    const gone = missingAssets((rel.assets || []).map((a) => a.name), rel.tag_name);
    if (gone.length) problems.push(`${rel.tag_name} is missing ${gone.join(', ')}; a published release cannot gain a file, so the next version has to carry it`);
    else say(`${rel.tag_name} carries every file`);
  }

  // 2. the mirror, by version and by size
  const node = (...a) => spawnSync(process.execPath, ['tools/release/r2-release.mjs', ...a], { stdio: 'inherit', env: process.env }).status;
  if (node('--check') === 0) {
    say('the mirror serves what GitHub does');
  } else if (repair && process.env.R2_ACCESS_KEY_ID) {
    say('the mirror is behind: bringing it up to date');
    if (node('--current') === 0) done.push('brought the update mirror up to date');
    else problems.push('the update mirror is behind and could not be brought up to date: see the log above');
  } else {
    problems.push('the update mirror is behind GitHub');
  }

  // 3. the Discord post, for a release (a beta is never announced)
  if (watched(stable) && !announced(stable)) {
    const run = await releaseRun(stable.tag_name);
    const jobs = run ? (await api(`actions/runs/${run.id}/jobs?filter=latest&per_page=50`)).jobs || [] : [];
    const notify = jobs.find((j) => j.name === 'notify');
    if (run && run.status !== 'completed') {
      say(`${stable.tag_name}: the release run is still going, the post is its job for now`);
    } else if (notify && notify.conclusion === 'success') {
      say(`${stable.tag_name} was announced by the release run`);
    } else if (repair) {
      try {
        await postToDiscord(stable);
        await api(`releases/${stable.id}`, { method: 'PATCH', body: { body: `${String(stable.body || '').trimEnd()}\n\n${ANNOUNCED}\n` } });
        done.push(`announced ${stable.tag_name} in Discord, which the release run had not`);
      } catch (err) {
        problems.push(`${stable.tag_name} was never announced in Discord, and posting it failed: ${err.message}`);
      }
    } else {
      problems.push(`${stable.tag_name} was never announced in Discord`);
    }
  }

  // 4. the antivirus report, on the release and on the beta
  for (const rel of [stable, beta].filter(watched)) {
    if (scanned(rel)) { say(`${rel.tag_name} carries its antivirus report`); continue; }
    const since = rel.published_at.slice(0, 19);
    const runs = ((await api(`actions/workflows/virustotal.yml/runs?created=${encodeURIComponent(`>=${since}`)}&per_page=30`)).workflow_runs || [])
      .filter((r) => String(r.display_title || '').includes(rel.tag_name));
    if (runs.some((r) => r.status !== 'completed')) {
      say(`${rel.tag_name}: the antivirus check is running`);
    } else if (runs.length) {
      problems.push(`${rel.tag_name}: the antivirus check ran ${runs.length} time(s) and wrote no report (${runs[0].html_url})`);
    } else if (repair) {
      await api('actions/workflows/virustotal.yml/dispatches', { method: 'POST', body: { ref: 'main', inputs: { tag: rel.tag_name } } });
      done.push(`asked for the antivirus check on ${rel.tag_name}, which nothing had run`);
    } else {
      problems.push(`${rel.tag_name}: nothing ran the antivirus check`);
    }
  }
}

for (const d of done) say(`fixed: ${d}`);
for (const p of problems) console.log(`::error::${p}`);
if (!problems.length) console.log('everything a release should leave behind is in place');
process.exit(problems.length ? 1 : 0);

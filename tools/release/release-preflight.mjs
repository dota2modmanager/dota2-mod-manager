#!/usr/bin/env node
/*
 * Before a release is built: will everything after publishing work?
 *
 * The jobs after publish need things this repository keeps elsewhere: the Discord webhook, the
 * bucket keys, the antivirus workflow, a changelog section in both languages. Each of them has been
 * wrong once, and each time the first sign came after the release was public, when there was no
 * stopping it: 2.7.1 reached neither the mirror nor Discord. Here, in the gate, a wrong one stops
 * the release while it is still a tag, before anything is built.
 *
 * Nothing here changes anything. The webhook is read, not posted to: a GET on a Discord webhook
 * answers with its name and posts nothing.
 *
 * A beta is held to less: it is not announced and needs no changelog, so a missing webhook or
 * section is a warning there and an error for a release.
 *
 * Usage (release.yml, gate job):
 *   TAG=v2.8.0 BETA=false GH_TOKEN=... DISCORD_WEBHOOK_URL=... R2_...=... node tools/release/release-preflight.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createR2 } from '../catalog/r2-client.js';

const require = createRequire(import.meta.url);
const { changelogSection } = require('./release-state.js');

const REPO = process.env.GITHUB_REPOSITORY || 'dota2modmanager/dota2-mod-manager';
const tag = process.env.TAG || '';
const version = tag.replace(/^v/, '');
const beta = process.env.BETA === 'true';
const errors = [];
const warnings = [];
const ok = (s) => console.log(`ok      ${s}`);
/** An error for a release, a warning for a beta. */
const releaseOnly = (s) => (beta ? warnings : errors).push(s);

async function gh(pathname) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/${pathname}`, { headers });
  return { status: res.status, json: res.ok ? await res.json() : null };
}

// The version the build will carry is the one in package.json: latest.yml announces it, the file
// names hold it. A tag that disagrees publishes a release whose feed names another version.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
if (pkg !== version) errors.push(`the tag says ${version} and package.json says ${pkg}: the feed would announce ${pkg}`);
else ok(`package.json carries ${version}`);

// A published release cannot be replaced once releases are immutable, and its tag cannot be used
// again. A run that finds one already out has nothing left to build.
const existing = await gh(`releases/tags/${tag}`);
if (existing.status === 200 && existing.json && !existing.json.draft) {
  errors.push(`${tag} is already published; a release cannot be built twice. Tag the next version instead`);
} else {
  ok(`${tag} is not published yet`);
}

// The release page, the Discord post and the "What's new" window read these two sections.
for (const file of ['CHANGELOG.md', 'CHANGELOG.ru.md']) {
  if (changelogSection(fs.readFileSync(file, 'utf8'), version)) ok(`${file} has a section for ${version}`);
  else releaseOnly(`${file} has no "## ${version}" section: the release page and the "What's new" window would be empty`);
}

// The webhook the notify job posts to.
const hook = process.env.DISCORD_WEBHOOK_URL;
if (!hook) {
  releaseOnly('DISCORD_WEBHOOK_URL is not set, so the release would go out without a Discord post');
} else {
  try {
    const res = await fetch(hook);
    const body = res.ok ? await res.json() : null;
    if (res.ok && body && body.id) ok(`the Discord webhook answers (${body.name || body.id})`);
    else releaseOnly(`the Discord webhook answers HTTP ${res.status}: it was deleted or its address changed`);
  } catch (err) {
    releaseOnly(`the Discord webhook could not be reached: ${err.message}`);
  }
}

// The bucket the mirror-update job writes to.
const r2 = createR2();
if (!r2.configured) {
  errors.push('the R2 keys are not set, so the update mirror would stay on the previous version');
} else {
  try {
    const listed = await r2.list('updates/');
    ok(`the update mirror's bucket answers (${listed.size} object(s) under updates/)`);
  } catch (err) {
    errors.push(`the update mirror's bucket refused the keys: ${err.message}`);
  }
}

// The two workflows the release relies on after publishing. A workflow GitHub disabled (sixty
// days without activity does that to a scheduled one) takes a dispatch and runs nothing.
for (const file of ['virustotal.yml', 'release-watch.yml']) {
  const w = await gh(`actions/workflows/${file}`);
  if (w.json && w.json.state === 'active') ok(`${file} is active`);
  else errors.push(`${file} is ${w.json ? w.json.state : `unreadable (HTTP ${w.status})`}, so nothing would run it`);
}

for (const w of warnings) console.log(`::warning::${w}`);
for (const e of errors) console.log(`::error::${e}`);
if (errors.length) {
  console.log(`\n${errors.length} thing(s) would break after publishing. Nothing was built; fix them and push the tag again.`);
  process.exit(1);
}
console.log(`\neverything after publishing has what it needs${warnings.length ? ` (${warnings.length} warning(s) for a beta)` : ''}`);

#!/usr/bin/env node
/**
 * What the antivirus engines say about a release, written into the release notes.
 *
 * An unsigned installer gets flagged. It happened here twice, and both times a user asked whether
 * the app was safe before anybody at this end knew there was anything to answer. Microsoft cleared
 * one false positive through their form; the other aged out. What was missing both times was a
 * report to point at: the file this repository built, read by seventy engines, at an address
 * anybody can open.
 *
 * So each published release is looked up on VirusTotal by the SHA-256 the release already carries
 * in SHA256SUMS, uploaded if VirusTotal has never seen it, and the verdict goes into the notes as
 * a table with a link per file. Nothing here decides whether the app is safe; it publishes what
 * the engines said and links the page where anyone can read the same thing.
 *
 * Detections are counted rather than obeyed: one or two engines calling an unsigned NSIS
 * installer a "trojan generic" is the normal state of the world, and failing a release on that
 * would train everybody to ignore this. The job goes red at FLAG_AT or more, which is a number
 * worth a person's morning.
 *
 * The key is optional. Without VIRUSTOTAL_API_KEY the workflow skips and says so: the release is
 * not held up by a check nobody has set up yet.
 *
 * Usage (inside .github/workflows/virustotal.yml):
 *   VIRUSTOTAL_API_KEY=... GH_TOKEN=... node tools/release/virustotal.mjs v2.6.13
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = 'https://www.virustotal.com/api/v3';
const REPO = process.env.GITHUB_REPOSITORY || 'dota2modmanager/dota2-mod-manager';

/** Enough engines to be worth reading before anybody downloads anything. */
export const FLAG_AT = 3;

/** The files worth a report: what a person actually runs. */
export const RUNNABLE = /\.(exe|AppImage)$/;

export const MARK = '<!-- virustotal -->';

/**
 * The hashes a release publishes, from its own SHA256SUMS.
 * @param {string} text  "<sha256>  <name>" per line, as sha256sum writes it
 * @returns {Array<{name: string, sha256: string}>}
 */
export function hashesFrom(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (m) out.push({ name: m[2], sha256: m[1].toLowerCase() });
  }
  return out;
}

/**
 * What one file's analysis stats mean.
 * @param {{malicious?: number, suspicious?: number, harmless?: number, undetected?: number}} stats
 */
export function verdict(stats) {
  const s = stats || {};
  const malicious = Number(s.malicious || 0);
  const suspicious = Number(s.suspicious || 0);
  const engines = malicious + suspicious + Number(s.harmless || 0) + Number(s.undetected || 0);
  return { malicious, suspicious, engines, flagged: malicious + suspicious, red: malicious >= FLAG_AT };
}

/** The notes section, one row per file. */
export function reportSection(rows, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const lines = [
    MARK,
    '',
    '### Checked with VirusTotal',
    '',
    '| File | Engines | Flagged | Report |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const link = row.url ? `[open](${row.url})` : 'not available';
    const flagged = row.engines ? `${row.flagged} of ${row.engines}` : 'not analysed yet';
    lines.push(`| \`${row.name}\` | ${row.engines || '-'} | ${flagged} | ${link} |`);
  }
  lines.push('', `Read on ${day}. An engine count is a reading, not a verdict: an installer without a paid`);
  lines.push('signature is flagged by a few engines as a matter of course.');
  return lines.join('\n');
}

/**
 * Put the section into release notes, replacing the one from a previous run.
 * @param {string} body
 * @param {string} section
 */
export function withReport(body, section) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const at = text.indexOf(MARK);
  const kept = (at === -1 ? text : text.slice(0, at)).replace(/\s+$/, '');
  // Lines other jobs leave after the report, out of sight: release.yml notes there that the Discord
  // post went out, and tools/release/release-watch.mjs reads that line so the post is sent once.
  const hidden = at === -1 ? [] : text.slice(at + MARK.length).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('<!--') && l.endsWith('-->'));
  const tail = hidden.length ? `\n${hidden.join('\n')}\n` : '';
  return kept ? `${kept}\n\n${section}\n${tail}` : `${section}\n${tail}`;
}

/* ---------- the part that talks to VirusTotal and GitHub ---------- */

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

async function vt(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'x-apikey': process.env.VIRUSTOTAL_API_KEY, ...(opts.headers || {}) } });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** The report for a hash, or null when VirusTotal has never seen the file. */
async function reportFor(sha256) {
  const res = await vt(`${API}/files/${sha256}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`VirusTotal answered HTTP ${res.status} for ${sha256.slice(0, 12)}`);
  return res.json.data.attributes.last_analysis_stats;
}

/**
 * Hand VirusTotal a file it has not seen. Above 32 MB it wants an address of its own.
 * The bytes are passed in rather than read here: a size from a stat and a read of the same path
 * are two answers about a file that can change in between (CodeQL js/file-system-race).
 */
async function upload(name, bytes) {
  let url = `${API}/files`;
  if (bytes.length > 32 * 1024 * 1024) {
    const where = await vt(`${API}/files/upload_url`);
    if (where.status !== 200) throw new Error(`VirusTotal would not give an upload address: HTTP ${where.status}`);
    url = where.json.data;
  }
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const res = await fetch(url, { method: 'POST', headers: { 'x-apikey': process.env.VIRUSTOTAL_API_KEY }, body: form });
  if (res.status !== 200) throw new Error(`VirusTotal refused the upload: HTTP ${res.status}`);
  return (await res.json()).data.id;
}

/** Wait for an analysis to finish, within reason. */
async function waitFor(analysisId, { tries = 20, waitMs = 30000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await vt(`${API}/analyses/${analysisId}`);
    const attrs = res.status === 200 ? res.json.data.attributes : null;
    if (attrs && attrs.status === 'completed') return attrs.stats;
    await sleep(waitMs);
  }
  return null;
}

async function main() {
  const tag = process.argv[2];
  if (!tag) throw new Error('usage: node tools/release/virustotal.mjs <tag>');
  if (!process.env.VIRUSTOTAL_API_KEY) {
    console.log('VIRUSTOTAL_API_KEY is not set: nothing checked, nothing written');
    return 0;
  }

  const assets = JSON.parse(gh(['api', `repos/${REPO}/releases/tags/${tag}`, '--jq', '{body: .body, assets: [.assets[] | {name, id}]}']));
  const sums = assets.assets.find((a) => a.name === 'SHA256SUMS');
  if (!sums) throw new Error(`${tag} carries no SHA256SUMS`);
  const text = gh(['api', '-H', 'Accept: application/octet-stream', `repos/${REPO}/releases/assets/${sums.id}`]);
  const files = hashesFrom(text).filter((f) => RUNNABLE.test(f.name));
  console.log(`${tag}: ${files.length} file(s) to check`);

  const rows = [];
  let worst = 0;
  for (const file of files) {
    let stats = await reportFor(file.sha256);
    if (!stats) {
      const asset = assets.assets.find((a) => a.name === file.name);
      // as bytes, never as text: an installer read through a string encoding is not the installer
      const bytes = execFileSync('gh', ['api', '-H', 'Accept: application/octet-stream', `repos/${REPO}/releases/assets/${asset.id}`], { maxBuffer: 512 * 1024 * 1024 });
      console.log(`${file.name}: new to VirusTotal, uploading ${(bytes.length / 1024 ** 2).toFixed(0)} MB`);
      stats = await waitFor(await upload(file.name, bytes));
    }
    const v = verdict(stats);
    worst = Math.max(worst, v.malicious);
    rows.push({ name: file.name, url: `https://www.virustotal.com/gui/file/${file.sha256}`, ...v });
    console.log(`${file.name}: ${v.flagged} of ${v.engines} engines`);
  }

  const body = withReport(assets.body, reportSection(rows));
  fs.writeFileSync('vt-notes.md', body);
  gh(['release', 'edit', tag, '--repo', REPO, '--notes-file', 'vt-notes.md']);
  fs.rmSync('vt-notes.md', { force: true });
  console.log('the report is in the release notes');

  if (worst >= FLAG_AT) {
    console.log(`::error::${worst} engines call a file of ${tag} malicious. Read the report before telling anybody the release is fine.`);
    return 1;
  }
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).endsWith(`${path.sep}virustotal.mjs`);
if (invokedDirectly) process.exit(await main());

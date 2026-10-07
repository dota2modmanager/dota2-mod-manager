#!/usr/bin/env node
/**
 * Every Dota build, read the hour it ships, in one issue called "Dota updates".
 *
 * Build 6946 (2026-10-07) renamed the search-path key the language folder is mounted by, and mods
 * stopped loading behind older patches. The rename was public in SteamTracking's GameTracking-Dota2
 * within the hour; this repository found out from a Discord announcement the same evening. So every
 * thirty minutes this asks GameTracking for the newest build, and when it is one the issue has not
 * seen, it comments there with what changed (tools/dota-diff.mjs reads it):
 *
 *   - what the app has to act on: the search paths in gameinfo.gi, the engine's search-path keys,
 *     the branch file, the item table;
 *   - the pak01 diff, by folder and by hero;
 *   - which catalog mods replace files the update changed or removed, from mod-paths.json, which
 *     the fingerprint job writes to the catalog-data branch. Those are the mods whose authors have
 *     a reason to rebuild.
 *
 * The issue body carries the last build it reported, in a comment, and is the only state there is.
 * When the first group changes, the maintainer also gets one Discord message (the radar's private
 * webhook): that is the kind of change that breaks the app's patch. The webhook address is never
 * printed.
 *
 *   GH_TOKEN=... node tools/dota-watch.mjs --catalog data/mod-paths.json
 *   node tools/dota-watch.mjs --dry [--catalog ...]     print the comment, change nothing
 *   node tools/dota-watch.mjs --dry 6944 6952           a given pair, printed
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCommits, compare } from './dota-diff.mjs';

export const TITLE = 'Dota updates';
const REPO = process.env.GITHUB_REPOSITORY || 'dota2modmanager/dota2-mod-manager';
const MARK = /<!-- dota-watch last=(\d+) sha=([0-9a-f]{40}) -->/;

// ---------- pure parts (test/dota-watch.test.js) ----------

/** The build and commit the issue last reported, or null. */
export function lastSeen(body) {
  const m = MARK.exec(String(body || ''));
  return m ? { build: Number(m[1]), sha: m[2] } : null;
}

/** The issue body: what this is, and where it stopped. */
export function issueBody(build, sha) {
  return [
    'Every Dota build, compared with the one before it, from [SteamTracking/GameTracking-Dota2](https://github.com/SteamTracking/GameTracking-Dota2). Written by `tools/dota-watch.mjs` every thirty minutes; each new build is a comment below.',
    '',
    'Each comment starts with what the app depends on: the search paths in `gameinfo.gi` (the safe-mode-off patch copies them), the search-path keys the engine reads, `gameinfo_branchspecific.gi` and `items_game.txt`. Then the `pak01` changes, and the catalog mods that replace files the update changed or removed: those are the mods to rebuild.',
    '',
    'To compare any two builds yourself: `npm run dota:diff -- <from> <to>`.',
    '',
    `<!-- dota-watch last=${build} sha=${sha} -->`,
  ].join('\n');
}

/** mod-paths.json back into key -> { name, categoryId, styleLabel, paths } */
export function readCatalogPaths(json) {
  const out = new Map();
  for (const [key, m] of Object.entries((json && json.mods) || {})) {
    const paths = [];
    for (const [dir, files] of Object.entries(m.dirs || {})) for (const f of files) paths.push(dir ? `${dir}/${f}` : f);
    out.set(key, { name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel || null, paths });
  }
  return out;
}

/**
 * Catalog mods the update reached, busiest first. A file Valve ships for the first time under a
 * mod's path counts as changed, as it does in the app (src/update-impact.ts).
 */
export function catalogImpact(catalog, diff) {
  const changed = new Set([...diff.modified, ...diff.added]);
  const gone = new Set(diff.removed);
  const out = [];
  for (const [key, m] of catalog) {
    let c = 0;
    let r = 0;
    for (const p of m.paths) { if (changed.has(p)) c++; else if (gone.has(p)) r++; }
    if (c || r) out.push({ key, name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel, changed: c, removed: r });
  }
  return out.sort((a, b) => (b.changed + b.removed) - (a.changed + a.removed) || a.key.localeCompare(b.key));
}

/** Whether the report touches what the app's patch is built from. */
export function critical(r) {
  const w = r.watch;
  return Boolean(w.searchPaths.gone.length || w.searchPaths.came.length || w.engineKeys.gone.length || w.engineKeys.came.length || w.branchChanged);
}

const bytes = (v) => (v ? `${Number(v.split(':')[1]).toLocaleString('en')} bytes` : 'none');
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;

/** The comment for one report. */
export function renderMarkdown(r, impact = null, { top = 12, mods = 40 } = {}) {
  const L = [];
  const day = (d) => String(d || '').slice(0, 10);
  L.push(`## Dota ${r.from.build} → ${r.to.build}`, '');
  L.push(`[Compare on GameTracking](${r.compare}) · ${day(r.from.date)} → ${day(r.to.date)}`, '');

  L.push('### What the app depends on', '');
  const sp = r.watch.searchPaths;
  if (sp.gone.length || sp.came.length) {
    L.push('- **The search paths in `gameinfo.gi` changed.** The patch copies this block (`src/patcher-gameinfo.ts`); the app rebuilds it on the next start, check that the result still mounts the language folder:', '');
    L.push('```diff', ...sp.gone.map((l) => `- ${l}`), ...sp.came.map((l) => `+ ${l}`), '```');
  } else L.push('- Search paths in `gameinfo.gi`: unchanged');
  const ek = r.watch.engineKeys;
  L.push(ek.gone.length || ek.came.length
    ? `- **Engine search-path keys changed:** ${[...ek.gone.map((k) => code(`-${k}`)), ...ek.came.map((k) => code(`+${k}`))].join(' ')}`
    : '- Engine search-path keys: unchanged');
  L.push(r.watch.branchChanged ? '- **`gameinfo_branchspecific.gi` changed:** Steam rewrote it, so the patch has to go back in' : '- `gameinfo_branchspecific.gi`: unchanged');
  L.push(r.watch.schema ? `- \`items_game.txt\` changed (${bytes(r.watch.schema.from)} → ${bytes(r.watch.schema.to)}): the item table is rebuilt on the next start` : '- `items_game.txt`: unchanged');
  L.push('');

  const c = r.pak.counts;
  L.push(`### pak01: ${c.added} added, ${c.modified} changed, ${c.removed} removed`, '');
  const folders = (title, rows) => {
    if (!rows.length) return;
    L.push(`<details><summary>${title} (${rows.length} folders)</summary>`, '', '| Files | Folder |', '|---:|---|');
    for (const [folder, n] of rows.slice(0, top)) L.push(`| ${n} | ${code(folder)} |`);
    if (rows.length > top) L.push(`| | and ${rows.length - top} more |`);
    L.push('', '</details>', '');
  };
  folders('Added', r.pak.added);
  folders('Changed', r.pak.modified);
  folders('Removed', r.pak.removed);
  if (r.pak.heroes.length) {
    L.push(`**Heroes:** ${r.pak.heroes.slice(0, top).map((h) => `${h.hero} (+${h.added} ~${h.modified} -${h.removed})`).join(', ')}${r.pak.heroes.length > top ? `, and ${r.pak.heroes.length - top} more` : ''}`, '');
  }

  if (impact) {
    L.push(`### Catalog mods that replace files this update changed or removed: ${impact.length}`, '');
    if (impact.length) {
      L.push('A mod like this puts its old copies back over Valve\'s new files. Usually nothing shows; sometimes a HUD or a screen breaks until the mod is rebuilt.', '');
      L.push('| Mod | Category | Changed | Removed |', '|---|---|---:|---:|');
      for (const m of impact.slice(0, mods)) L.push(`| ${m.name}${m.styleLabel ? ` (${m.styleLabel})` : ''} | ${m.categoryId} | ${m.changed} | ${m.removed} |`);
      if (impact.length > mods) L.push(`| and ${impact.length - mods} more | | | |`);
      L.push('');
    }
  } else {
    L.push('_The catalog\'s file lists were not available, so the mods are not listed._', '');
  }
  return L.join('\n');
}

/** The Discord message for a change that reaches the patch. Short: the issue has the rest. */
export function discordText(r, url) {
  const what = [];
  const sp = r.watch.searchPaths;
  if (sp.gone.length || sp.came.length) what.push(`gameinfo.gi search paths (${[...sp.gone.map((l) => `-${l}`), ...sp.came.map((l) => `+${l}`)].join('; ')})`);
  if (r.watch.engineKeys.gone.length || r.watch.engineKeys.came.length) what.push('engine search-path keys');
  if (r.watch.branchChanged) what.push('gameinfo_branchspecific.gi');
  return `Dota ${r.to.build} changed what the mod patch is built from: ${what.join(', ')}. ${url}`;
}

// ---------- GitHub ----------

async function api(route, { method = 'GET', body, token } = {}) {
  const res = await fetch(`https://api.github.com/${route}`, {
    method,
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dota2-mod-manager/dota-watch', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${route}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

function loadCatalog(file) {
  if (!file) return null;
  try { return readCatalogPaths(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) {
    console.log(`::warning::catalog file lists not read (${e.message}); the report goes out without them`);
    return null;
  }
}

async function main(argv) {
  const dry = argv.includes('--dry');
  const at = argv.indexOf('--catalog');
  const catalog = loadCatalog(at === -1 ? null : argv[at + 1]);
  const refs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--catalog');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  const commits = await buildCommits();
  const newest = commits[0];
  if (!newest) throw new Error('no build commits in GameTracking');

  // a pair asked for by hand: print it and stop
  if (refs.length) {
    const r = await compare(refs[0], refs[1] || null, { keepDiff: true, commits });
    console.log(renderMarkdown(r, catalog && catalogImpact(catalog, r.diff)));
    return;
  }

  const issues = token ? await api(`repos/${REPO}/issues?state=open&per_page=100`, { token }) : [];
  let issue = issues.find((i) => i.title === TITLE && !i.pull_request) || null;
  const seen = lastSeen(issue && issue.body);
  if (seen && seen.build >= newest.build) {
    console.log(`nothing new: the issue has ${seen.build}, GameTracking's newest is ${newest.build}`);
    return;
  }
  // with no issue yet, the first comment is the newest build against the one before it
  const r = await compare(seen ? seen.sha : null, newest.sha, { keepDiff: true, commits });
  const comment = renderMarkdown(r, catalog && catalogImpact(catalog, r.diff));

  if (dry || !token) {
    console.log(comment);
    if (critical(r)) console.log(`\n[discord] ${discordText(r, '<issue url>')}`);
    if (!token && !dry) console.log('::warning::no GH_TOKEN, so nothing was written');
    return;
  }
  if (!issue) issue = await api(`repos/${REPO}/issues`, { method: 'POST', body: { title: TITLE, body: issueBody(newest.build, newest.sha) }, token });
  const posted = await api(`repos/${REPO}/issues/${issue.number}/comments`, { method: 'POST', body: { body: comment }, token });
  await api(`repos/${REPO}/issues/${issue.number}`, { method: 'PATCH', body: { body: issueBody(newest.build, newest.sha) }, token });
  console.log(`reported ${r.from.build} -> ${r.to.build} in #${issue.number}`);

  const webhook = process.env.RADAR_DISCORD_WEBHOOK || '';
  if (critical(r)) {
    if (!webhook) { console.log('::warning::the update reaches the patch and RADAR_DISCORD_WEBHOOK is not set, so nobody was messaged'); return; }
    const res = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: discordText(r, posted.html_url), allowed_mentions: { parse: [] } }) });
    console.log(res.ok ? 'maintainer messaged on Discord' : `::warning::Discord answered ${res.status}`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}

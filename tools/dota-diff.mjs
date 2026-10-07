#!/usr/bin/env node
/**
 * What a Dota update changed, and what of it touches this app and the mods in it.
 *
 * Build 6946 (2026-10-07) renamed one word in gameinfo.gi, `Game_Language` to
 * `Game_AudioLanguage`, and mods in the language folder stopped loading for everyone whose
 * search-path patch was older than the update. The rename was public within the hour: SteamTracking's
 * GameTracking-Dota2 repository commits every build as text, and the commit showed it. Nobody here
 * was reading it.
 *
 * That repository has, per build:
 *   game/dota/steam.inf              the build number;
 *   game/dota/gameinfo.gi            the search paths the patch copies (src/patcher.ts);
 *   game/dota/pak01_dir.txt          every file in Valve's pak01 with its CRC and size, which is the
 *                                    whole content diff in one file (~390k lines);
 *   game/bin/win64/*_strings.txt     strings out of the binaries; engine2's list of search-path
 *                                    keys is how the rename showed up in the engine itself;
 *   game/dota/pak01_dir/...          decompiled scripts, English text and patch notes (since 6951).
 *
 * This reads two builds of it and prints the part this app has to act on first (search paths,
 * engine keys, the item table), then the pak01 diff by folder and by hero, and with --mods, which
 * files of the given mods the update changed or took away. A mod that replaces a file Valve just
 * changed now puts the old version back; one that replaces a file Valve removed carries dead weight.
 *
 *   node tools/dota-diff.mjs                        the newest build against the one before it
 *   node tools/dota-diff.mjs 6944 6952              two builds by number
 *   node tools/dota-diff.mjs 36e1e3d a6e0baf        or by GameTracking commit
 *   node tools/dota-diff.mjs --mods <vpk|folder>... which files of these mods the update touched
 *   node tools/dota-diff.mjs --json                 the same, as JSON
 *
 * GH_TOKEN or GITHUB_TOKEN lifts GitHub's limit of 60 API calls an hour; a run makes two or three.
 * Nothing is cached: a run fetches about 80 MB and takes a few seconds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'SteamTracking/GameTracking-Dota2';
const FILES = {
  inf: 'game/dota/steam.inf',
  gameinfo: 'game/dota/gameinfo.gi',
  branch: 'game/dota/gameinfo_branchspecific.gi',
  pak: 'game/dota/pak01_dir.txt',
  engine: 'game/bin/win64/engine2_strings.txt',
};
const SCHEMA = 'scripts/items/items_game.txt';

// ---------- pure parts (test/dota-diff.test.js) ----------

/** GameTracking's pak01_dir.txt: "path CRC:00xxxxxxxx size:N" per line, as path -> "crc:size". */
export function parsePakList(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^(.+?) CRC:0*([0-9a-f]+) size:(\d+)\s*$/i.exec(line);
    if (m) out.set(m[1], `${m[2].toLowerCase()}:${m[3]}`);
  }
  return out;
}

/** Paths added, changed (CRC or size) and removed between two lists, each sorted. */
export function diffLists(before, after) {
  const added = [];
  const modified = [];
  const removed = [];
  for (const [p, v] of after) {
    if (!before.has(p)) added.push(p);
    else if (before.get(p) !== v) modified.push(p);
  }
  for (const p of before.keys()) if (!after.has(p)) removed.push(p);
  return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

/** Paths counted by their first `depth` folders, largest first. */
export function byFolder(paths, depth = 3) {
  const counts = new Map();
  for (const p of paths) {
    const parts = p.split('/');
    const key = parts.slice(0, Math.min(depth, parts.length - 1)).join('/') || '(root)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// The places a hero's own content lives. Item folders count too: a skin mod replaces those.
const HERO_PATHS = [
  /^models\/heroes\/([^/]+)\//, /^materials\/models\/heroes\/([^/]+)\//, /^particles\/units\/heroes\/hero_([^/]+)\//,
  /^models\/items\/([^/]+)\//, /^materials\/models\/items\/([^/]+)\//, /^particles\/econ\/items\/([^/]+)\//,
  /^sounds\/vo\/([^/]+)\//, /^panorama\/images\/heroes\/(?:selection\/|icons\/)?npc_dota_hero_([a-z_]+?)(?:_png|_alt\d*|\.)/,
];

/** The hero folder a path belongs to, or null. */
export function heroOf(p) {
  for (const re of HERO_PATHS) {
    const m = re.exec(p);
    if (m) return m[1];
  }
  return null;
}

/** Per hero: how many of its files were added, changed and removed, busiest first. */
export function byHero(diff) {
  const rows = new Map();
  for (const kind of ['added', 'modified', 'removed']) {
    for (const p of diff[kind]) {
      const h = heroOf(p);
      if (!h) continue;
      if (!rows.has(h)) rows.set(h, { hero: h, added: 0, modified: 0, removed: 0 });
      rows.get(h)[kind]++;
    }
  }
  return [...rows.values()].sort((a, b) => (b.added + b.modified + b.removed) - (a.added + a.modified + a.removed) || a.hero.localeCompare(b.hero));
}

/** The lines of gameinfo.gi's SearchPaths block that mean something: no comments, spacing collapsed. */
export function searchPathLines(gameinfo) {
  if (!gameinfo) return [];
  const at = gameinfo.indexOf('SearchPaths');
  if (at === -1) return [];
  const open = gameinfo.indexOf('{', at);
  let depth = 0;
  let end = gameinfo.length;
  for (let i = open; i < gameinfo.length; i++) {
    if (gameinfo[i] === '{') depth++;
    else if (gameinfo[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  return gameinfo.slice(open + 1, end).split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, '').trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/** Lines only in a, lines only in b. Order is ignored: a moved line shows up as nothing. */
export function lineDiff(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return { gone: a.filter((l) => !sb.has(l)), came: b.filter((l) => !sa.has(l)) };
}

/**
 * The search-path keys the engine knows, from engine2's string dump: "game_audiolanguage",
 * "addonroot", "mod". Other strings starting with "game_" are mixed in ("game_dir"); only the
 * difference between two builds is shown, and that is where they cancel out.
 */
export function engineKeys(strings) {
  if (!strings) return [];
  return [...new Set(String(strings).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(?:game|mod|addonroot|write|publiccontent)(?:_[a-z]+)?$/.test(l)))].sort();
}

/** Which of a mod's files the update changed and removed. */
export function modImpact(modPaths, diff, changed = new Set(diff.modified), gone = new Set(diff.removed)) {
  const modified = [];
  const removed = [];
  for (const p of modPaths) {
    const k = String(p).toLowerCase().replace(/\\/g, '/');
    if (changed.has(k)) modified.push(k);
    else if (gone.has(k)) removed.push(k);
  }
  return { modified: modified.sort(), removed: removed.sort() };
}

/** The build number in a steam.inf, or null. */
export function buildOf(inf) {
  const m = /^ClientVersion=(\d+)/m.exec(String(inf || ''));
  return m ? Number(m[1]) : null;
}

// ---------- GitHub ----------

const token = () => process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

async function github(url) {
  const headers = { 'User-Agent': 'dota2-mod-manager/dota-diff', Accept: 'application/vnd.github+json' };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** GameTracking commits that are builds ("6952 | 6 files | ..."), newest first. */
async function buildCommits(pages = 2) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const list = await github(`https://api.github.com/repos/${REPO}/commits?per_page=100&page=${page}`);
    for (const c of list) {
      const m = /^(\d+) \|/.exec(c.commit.message);
      if (m) out.push({ sha: c.sha, build: Number(m[1]), date: c.commit.author.date });
    }
    if (list.length < 100) break;
  }
  return out;
}

/** A build number or a commit, as the commit holding that build's final state. */
async function resolve(ref, commits) {
  if (/^\d{3,5}$/.test(ref)) {
    const hit = commits.find((c) => c.build === Number(ref));
    if (!hit) throw new Error(`build ${ref} is not among the last ${commits.length} tracked builds`);
    return hit;
  }
  const c = await github(`https://api.github.com/repos/${REPO}/commits/${ref}`);
  const m = /^(\d+) \|/.exec(c.commit.message);
  return { sha: c.sha, build: m ? Number(m[1]) : null, date: c.commit.author.date };
}

/**
 * A tracked file at a commit, from raw.githubusercontent; null when it is not there. Nothing is
 * kept on disk: a run downloads about 80 MB in a few seconds, and a cache of network bytes in a
 * shared temp folder is a thing to defend rather than a saving.
 */
async function file(sha, rel) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a commit: ${sha}`);
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${rel}`, { headers: { 'User-Agent': 'dota2-mod-manager/dota-diff' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${rel} at ${sha.slice(0, 7)}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString('latin1');
}

// ---------- mods ----------

/**
 * Every VPK index under the given files and folders. Data volumes (_000.vpk) are not indexes, and
 * a pak01_dir.vpk found inside a folder is Valve's own (the voice pack in dota_<language>), not a
 * mod; named directly, it is read like any other file.
 */
export function vpksIn(targets) {
  const out = [];
  const walk = (p, named) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const n of fs.readdirSync(p).sort()) walk(path.join(p, n), false); return; }
    if (!/\.vpk$/i.test(p) || /_\d{3}\.vpk$/i.test(p)) return;
    if (!named && /^pak01_dir\.vpk$/i.test(path.basename(p))) return;
    out.push(p);
  };
  for (const t of targets) walk(t, true);
  return out;
}

async function modsReport(targets, diff) {
  const { listVpkPathsFile } = await import('../src/vpk.ts');
  const changed = new Set(diff.modified);
  const gone = new Set(diff.removed);
  const out = [];
  for (const vpk of vpksIn(targets)) {
    let paths;
    try { paths = listVpkPathsFile(vpk); } catch (e) { out.push({ vpk, error: e.message }); continue; }
    out.push({ vpk, files: paths.length, ...modImpact(paths, diff, changed, gone) });
  }
  return out;
}

// ---------- the report ----------

export async function compare(fromRef, toRef, { mods = [] } = {}) {
  const commits = await buildCommits();
  if (!commits.length) throw new Error('no build commits found in GameTracking');
  const to = toRef ? await resolve(toRef, commits) : commits[0];
  const from = fromRef ? await resolve(fromRef, commits) : commits.find((c) => c.build !== null && c.build < to.build);
  if (!from) throw new Error(`no build before ${to.build} among the tracked commits`);

  const [a, b] = await Promise.all([from, to].map(async (c) => {
    const [inf, gameinfo, branch, pak, engine] = await Promise.all(Object.values(FILES).map((rel) => file(c.sha, rel)));
    return { inf, gameinfo, branch, pak, engine };
  }));
  const before = parsePakList(a.pak || '');
  const after = parsePakList(b.pak || '');
  const diff = diffLists(before, after);

  const report = {
    from: { ...from, build: buildOf(a.inf) ?? from.build },
    to: { ...to, build: buildOf(b.inf) ?? to.build },
    compare: `https://github.com/${REPO}/compare/${from.sha.slice(0, 12)}...${to.sha.slice(0, 12)}`,
    watch: {
      searchPaths: lineDiff(searchPathLines(a.gameinfo), searchPathLines(b.gameinfo)),
      branchChanged: a.branch !== b.branch,
      engineKeys: lineDiff(engineKeys(a.engine), engineKeys(b.engine)),
      schema: before.get(SCHEMA) !== after.get(SCHEMA)
        ? { from: before.get(SCHEMA) || null, to: after.get(SCHEMA) || null } : null,
    },
    pak: {
      counts: { added: diff.added.length, modified: diff.modified.length, removed: diff.removed.length },
      added: byFolder(diff.added), modified: byFolder(diff.modified), removed: byFolder(diff.removed),
      heroes: byHero(diff),
      removedPaths: diff.removed,
    },
  };
  if (mods.length) report.mods = await modsReport(mods, diff);
  return report;
}

const size = (v) => (v ? `${Number(v.split(':')[1]).toLocaleString('en')} bytes` : 'none');

export function render(r, { top = 15 } = {}) {
  const L = [];
  const day = (d) => String(d || '').slice(0, 10);
  L.push(`Dota ${r.from.build} -> ${r.to.build}  (${day(r.from.date)} -> ${day(r.to.date)})`);
  L.push(r.compare, '');

  L.push('What the app has to act on');
  const sp = r.watch.searchPaths;
  if (sp.gone.length || sp.came.length) {
    L.push('  ! gameinfo.gi search paths changed. The patch copies this block: check src/patcher-gameinfo.ts');
    for (const l of sp.gone) L.push(`      - ${l}`);
    for (const l of sp.came) L.push(`      + ${l}`);
  } else L.push('  ok gameinfo.gi search paths unchanged');
  const ek = r.watch.engineKeys;
  if (ek.gone.length || ek.came.length) {
    L.push(`  ! engine search-path keys: ${[...ek.gone.map((k) => `-${k}`), ...ek.came.map((k) => `+${k}`)].join(' ')}`);
  } else L.push('  ok engine search-path keys unchanged');
  L.push(r.watch.branchChanged ? '  ! gameinfo_branchspecific.gi changed: Steam rewrote it, the patch has to go back in' : '  ok gameinfo_branchspecific.gi unchanged');
  L.push(r.watch.schema
    ? `  i  items_game.txt changed (${size(r.watch.schema.from)} -> ${size(r.watch.schema.to)}): the built item table is rebuilt on the next start`
    : '  ok items_game.txt unchanged');
  L.push('');

  const c = r.pak.counts;
  L.push(`pak01: ${c.added} added, ${c.modified} changed, ${c.removed} removed`);
  for (const [title, rows] of [['added', r.pak.added], ['changed', r.pak.modified], ['removed', r.pak.removed]]) {
    if (!rows.length) continue;
    L.push(`  ${title}:`);
    for (const [folder, n] of rows.slice(0, top)) L.push(`    ${String(n).padStart(6)}  ${folder}`);
    if (rows.length > top) L.push(`    ... ${rows.length - top} more folders`);
  }
  if (r.pak.heroes.length) {
    L.push('', 'heroes (added / changed / removed files):');
    for (const h of r.pak.heroes.slice(0, top)) L.push(`  ${h.hero.padEnd(24)} +${h.added} ~${h.modified} -${h.removed}`);
    if (r.pak.heroes.length > top) L.push(`  ... ${r.pak.heroes.length - top} more`);
  }
  if (r.mods) {
    L.push('', 'mods:');
    for (const m of r.mods) {
      if (m.error) { L.push(`  ${m.vpk}: not readable (${m.error})`); continue; }
      const hit = m.modified.length + m.removed.length;
      L.push(`  ${hit ? '!' : 'ok'} ${m.vpk}: ${m.files} files, ${m.modified.length} changed by Valve, ${m.removed.length} removed by Valve`);
      for (const p of m.removed.slice(0, 5)) L.push(`      - ${p}`);
      for (const p of m.modified.slice(0, 5)) L.push(`      ~ ${p}`);
      if (hit > 10) L.push(`      ... ${hit - Math.min(5, m.removed.length) - Math.min(5, m.modified.length)} more`);
    }
  }
  return L.join('\n');
}

async function main(argv) {
  const json = argv.includes('--json');
  const at = argv.indexOf('--mods');
  const mods = at === -1 ? [] : argv.slice(at + 1).filter((a) => !a.startsWith('--'));
  const refs = (at === -1 ? argv : argv.slice(0, at)).filter((a) => !a.startsWith('--'));
  const [fromRef, toRef] = refs.length === 1 ? [null, refs[0]] : refs;
  const r = await compare(fromRef || null, toRef || null, { mods });
  if (json) console.log(JSON.stringify(r, null, 1));
  else console.log(render(r));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}

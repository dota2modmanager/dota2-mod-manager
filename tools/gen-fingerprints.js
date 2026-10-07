#!/usr/bin/env node
// Build fingerprints.json: maps each catalog mod's content fingerprint to its identity,
// so the app can recognise the same mod when it was installed from the website or another
// tool and offer to adopt it without re-downloading.
//
// Incremental: state is checkpointed in fingerprints.state.json (per-mod catalog stamp +
// fingerprint), so a re-run only fetches mods that are new or changed. The first full run
// downloads every catalog mod (~1000+ files) and is safe to stop and resume. tools/ are
// skipped (not mods); mods packed as loose files (cursors, fonts) are hashed too.
//
//   node tools/gen-fingerprints.js                 # incremental run, writes ./fingerprints.json
//   node tools/gen-fingerprints.js --limit 20      # only first 20 (for testing)
//   node tools/gen-fingerprints.js --conc 8        # 8 parallel downloads (default 5)
//   node tools/gen-fingerprints.js --fresh         # ignore state, rebuild from scratch
//   node tools/gen-fingerprints.js --out p.json --progress p.state.json
//
// It also writes mod-paths.json: every file each pak mod replaces, grouped by folder, which
// tools/dota-watch.mjs reads to say which catalog mods a Dota update reached.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { RAW_BASE } = require('../src/catalog.ts');
const { fingerprintVpk, fingerprintFiles, listVpkPaths, analyzeVpkPaths, subjectHeroes } = require('../src/vpk.ts');
const { jsonLinesFile } = require('./json-lines');

// tools aren't mods (they're utilities/programs) — never fingerprint them
const SKIP_CATEGORIES = new Set(['tools']);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)$/);
    if (!m) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[m[1]] = true;
    else { a[m[1]] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const OUT = path.resolve(args.out || path.join(__dirname, '..', 'fingerprints.json'));
const HEROES_OUT = path.resolve(args.heroes || path.join(__dirname, '..', 'hero-index.json'));
const PATHS_OUT = path.resolve(args.paths || path.join(__dirname, '..', 'mod-paths.json'));
const PROGRESS = path.resolve(args.progress || path.join(__dirname, '..', 'fingerprints.state.json'));
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONC = Math.max(1, Number(args.conc || 5));
const FRESH = !!args.fresh;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The separator is a NUL because no category, name or style label can contain one; it is
// written as an escape rather than typed in, or this file is a binary blob to git, to
// grep and to every diff (and the one text file in the repository that * text=auto skips).
const keyOf = (t) => `${t.categoryId}\u0000${t.name}\u0000${t.styleLabel || ''}`;

function fileUrl(categoryId, fileRef) {
  if (/^https?:\/\//i.test(fileRef)) return fileRef;
  return `${RAW_BASE}/assets/files/${categoryId}/${encodeURIComponent(fileRef)}`;
}

async function fetchBuf(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) { last = e; await sleep(600 * (i + 1)); }
  }
  throw last;
}

const IGNORE_FILE = /(^|\/)(guide\.txt|install\.bat|uninstall\.bat|readme[^/]*)$/i;

// Loose payload files of a mod, each keyed by basename so the fingerprint reproduces
// from the installed files regardless of the zip's folder wrapper. Category-scoped to
// exactly what the installer lays down: cursors -> the cursor/ set, fonts -> assets/custom.
function looseFiles(entries, categoryId) {
  const pick = (re) => entries
    .map((e) => ({ e, m: e.entryName.replace(/\\/g, '/').match(re) }))
    .filter((x) => x.m)
    .map((x) => ({ path: x.m[1].split('/').pop().toLowerCase(), data: x.e.getData() }));
  if (categoryId === 'cursors') return pick(/(?:^|\/)cursor\/(.+)$/i);
  if (categoryId === 'fonts') return pick(/assets\/custom\/(.+)$/i);
  const out = [];
  for (const e of entries) {
    const rel = e.entryName.replace(/\\/g, '/');
    const l = rel.toLowerCase();
    if (!rel.split('/').pop() || l.includes('!guide') || IGNORE_FILE.test(l) || l.endsWith('.vpk')) continue;
    out.push({ path: rel.split('/').pop().toLowerCase(), data: e.getData() });
  }
  return out;
}

// Content fingerprint of a mod file. Prefers any VPK inside (hero skins use a *_dir.vpk,
// terrains ship maps/dota.vpk), and falls back to hashing loose files (cursors, fonts).
// Returns { fp, type: 'vpk'|'files' } or null when there's nothing to fingerprint.
/**
 * Which heroes a mod is actually about, read out of the archive it is packed in.
 *
 * The catalog does not record this: a hero mod is a name and a file, and "Bare Brewmaster"
 * says Brewmaster only to a human. The app works it out from the model paths inside the VPK
 * at install time, and this job already has every one of those archives open, so it costs a
 * second parse rather than another thousand downloads.
 */
function heroesOf(vpkBuf) {
  try {
    const a = analyzeVpkPaths(listVpkPaths(vpkBuf));
    return {
      kind: a.kind,
      subjects: subjectHeroes(a).map((h) => ({ id: h.id, name: h.name, slots: h.slots, models: h.models })),
    };
  } catch {
    return { kind: null, subjects: [] };
  }
}

/**
 * The files a pak mod puts in the language folder, for tools/dota-watch.mjs to hold against what a
 * Dota update changed. A whole-map terrain (maps/dota.vpk) replaces one file outside pak01, and the
 * paths inside it are the map's own, so it has none: null, which also marks it as read.
 */
function pathsOf(vpkBuf, isPak) {
  if (!isPak) return null;
  try { return listVpkPaths(vpkBuf).sort(); } catch { return null; }
}

function fingerprintBuf(buf, fileRef, categoryId) {
  const lower = fileRef.toLowerCase();
  if (lower.endsWith('.vpk')) return { fp: fingerprintVpk(buf), type: 'vpk', ...heroesOf(buf), paths: pathsOf(buf, true) };
  if (!lower.endsWith('.zip')) return null;

  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const vpkEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('_dir.vpk'))
    || entries.find((e) => e.entryName.toLowerCase().endsWith('.vpk'));
  if (vpkEntry) {
    try {
      const inner = vpkEntry.getData();
      return { fp: fingerprintVpk(inner), type: 'vpk', ...heroesOf(inner), paths: pathsOf(inner, vpkEntry.entryName.toLowerCase().endsWith('_dir.vpk')) };
    } catch { /* fall through */ }
  }
  const files = looseFiles(entries, categoryId);
  if (!files.length) return null;
  // per-file hashes let the app subset-match mods that share a folder with vanilla files
  // (fonts): "are all of this mod's files present in panorama/fonts with matching content?"
  const hashes = {};
  for (const f of files) hashes[f.path] = crypto.createHash('sha1').update(f.data).digest('hex');
  return { fp: fingerprintFiles(files), type: 'files', hashes };
}

// a stable per-mod version marker from the catalog, so unchanged mods are skipped
function stampOf(mod) {
  const m = mod.meta || {};
  return String(m['commit-sha'] || m.date || '');
}

function* iterMods(modsData) {
  for (const [categoryId, data] of Object.entries(modsData)) {
    if (SKIP_CATEGORIES.has(categoryId)) continue;
    const arr = Array.isArray(data) ? data
      : (data && data.groups ? data.groups.flatMap((g) => g.mods || []) : []);
    for (const mod of arr) {
      if (!mod || typeof mod !== 'object' || !mod.name) continue;
      const stamp = stampOf(mod);
      if (Array.isArray(mod.styles) && mod.styles.length) {
        for (const st of mod.styles) {
          if (st && st.file) yield { categoryId, name: mod.name, styleLabel: st.label || null, fileRef: st.file, stamp };
        }
      } else if (mod.file) {
        yield { categoryId, name: mod.name, styleLabel: null, fileRef: mod.file, stamp };
      }
    }
  }
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}

async function main() {
  console.log('catalog:', `${RAW_BASE}/assets/data/mods.json`);
  const modsData = JSON.parse((await fetchBuf(`${RAW_BASE}/assets/data/mods.json`)).toString()).modsData;

  const all = [...iterMods(modsData)].filter((t) => /\.(vpk|zip)$/i.test(t.fileRef));
  const targets = all.slice(0, LIMIT === Infinity ? all.length : LIMIT);

  const progress = FRESH ? { processed: {} } : loadJson(PROGRESS, { processed: {} });
  // drop stale state: tools (never mods) and anything no longer in the catalog.
  // keyed off the full catalog (all), not the possibly --limit-ed target slice.
  const live = new Set(all.map(keyOf));
  for (const k of Object.keys(progress.processed)) {
    if (SKIP_CATEGORIES.has(progress.processed[k].categoryId) || !live.has(k)) delete progress.processed[k];
  }
  // backfill older state that predates stamp/type so it counts as up-to-date
  for (const t of targets) {
    const rec = progress.processed[keyOf(t)];
    if (rec && rec.fp && rec.stamp === undefined) { rec.stamp = t.stamp; rec.type = rec.type || 'vpk'; }
  }
  // re-fetch when new, when the catalog stamp changed, or when it previously had no fingerprint
  const pending = targets.filter((t) => {
    if (FRESH) return true;
    const rec = progress.processed[keyOf(t)];
    if (!(rec && rec.fp && rec.stamp === t.stamp)) return true;
    // State written before this job learned to read heroes: that archive has to come back
    // once. Spread over the scheduled runs rather than forced into one, which is what the
    // resume behaviour already exists for.
    // The same once more for the file lists mod-paths.json is made of (2026-10-07).
    return rec.type === 'vpk' && (rec.subjects === undefined || rec.paths === undefined);
  });
  console.log(`mods with vpk/zip: ${all.length}; this run: ${targets.length}; up-to-date: ${targets.length - pending.length}; to (re)fetch: ${pending.length}`);
  console.log(`state: ${PROGRESS}\noutput: ${OUT}\nheroes: ${HEROES_OUT}
concurrency: ${CONC}\n`);

  let done = 0, ok = 0, skip = 0, fail = 0;
  let sinceSave = 0;

  /**
   * hero-index.json: which mods are about which hero, for the site to build pages from.
   *
   * Sorted throughout and carrying no timestamp, for the same reason the fingerprints carry
   * none: the scheduled run commits this file, and one that reorders itself each time is a
   * commit every thirty minutes saying nothing.
   */
  const writeHeroIndex = () => {
    const heroes = {};
    for (const rec of Object.values(progress.processed)) {
      if (!Array.isArray(rec.subjects) || !rec.subjects.length) continue;
      for (const h of rec.subjects) {
        const entry = heroes[h.id] || (heroes[h.id] = { name: h.name, mods: [] });
        entry.mods.push({ name: rec.name, categoryId: rec.categoryId, styleLabel: rec.styleLabel || null, slots: h.slots || [] });
      }
    }
    const byHero = {};
    for (const id of Object.keys(heroes).sort()) {
      const e = heroes[id];
      e.mods.sort((a, b) => a.name.localeCompare(b.name) || String(a.styleLabel).localeCompare(String(b.styleLabel)));
      byHero[id] = e;
    }
    const mods = Object.values(byHero).reduce((n, e) => n + e.mods.length, 0);
    fs.writeFileSync(HEROES_OUT, jsonLinesFile({ heroes: Object.keys(byHero).length, mods, byHero }));
  };

  /**
   * mod-paths.json: the files each pak mod replaces, by folder, for tools/dota-watch.mjs.
   * Sorted and timeless like the files beside it, one mod per line and one folder per line inside
   * it, so a commit shows the mods that changed.
   */
  const writePaths = () => {
    const mods = {};
    for (const rec of Object.values(progress.processed)) {
      if (!Array.isArray(rec.paths) || !rec.paths.length) continue;
      const dirs = {};
      for (const p of rec.paths) {
        const at = p.lastIndexOf('/');
        (dirs[at === -1 ? '' : p.slice(0, at)] ||= []).push(at === -1 ? p : p.slice(at + 1));
      }
      const key = `${rec.categoryId}/${rec.name}${rec.styleLabel ? ` [${rec.styleLabel}]` : ''}`;
      mods[key] = { name: rec.name, categoryId: rec.categoryId, styleLabel: rec.styleLabel || null, dirs };
    }
    const sorted = {};
    for (const k of Object.keys(mods).sort()) sorted[k] = mods[k];
    // a folder's files stay on one line up to a few kilobytes: the record is a list, not a table
    fs.writeFileSync(PATHS_OUT, jsonLinesFile({ count: Object.keys(sorted).length, mods: sorted }, { inlineAt: 4000 }));
  };

  const save = () => {
    // app-facing exact-match map: fingerprint -> [identity, ...]. A list because
    // different catalog entries can share the same file (GLaDOS + Ru GLaDOS both point
    // at pak26_dir.vpk) — keep every name instead of dropping all but one. Fonts are
    // excluded here: they mix with vanilla files in panorama\fonts, so an exact folder
    // fingerprint never reproduces — they go in `fonts` for subset matching instead.
    const mods = {};
    const fonts = [];
    for (const rec of Object.values(progress.processed)) {
      if (!rec.fp) continue;
      if (rec.categoryId === 'fonts') {
        if (rec.hashes) fonts.push({ name: rec.name, categoryId: rec.categoryId, styleLabel: rec.styleLabel || null, files: rec.hashes });
        continue;
      }
      const id = { name: rec.name, categoryId: rec.categoryId, styleLabel: rec.styleLabel || null, type: rec.type || 'vpk' };
      const list = mods[rec.fp] || (mods[rec.fp] = []);
      if (!list.some((x) => x.name === id.name && x.categoryId === id.categoryId && x.styleLabel === id.styleLabel)) list.push(id);
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    // no timestamp in the output: it must change only on real content changes, or the
    // scheduled CI run would commit a new file every time and churn the repo.
    //
    // Sorted for the other half of that rule, which this file was missing while the hero
    // index next to it had it: the map is built by walking the checkpoint, so a re-run that
    // retried a failed download put its entry back somewhere else and committed a reordering
    // that changed nothing. One fingerprint per line for the same reader, so the commit shows
    // the mods that arrived rather than one changed line 170 KB wide (tools/json-lines.js).
    const sorted = {};
    for (const fp of Object.keys(mods).sort()) sorted[fp] = mods[fp];
    fonts.sort((a, b) => a.name.localeCompare(b.name) || String(a.styleLabel).localeCompare(String(b.styleLabel)));
    fs.writeFileSync(OUT, jsonLinesFile({ count: Object.keys(sorted).length, mods: sorted, fonts }));
    fs.mkdirSync(path.dirname(PROGRESS), { recursive: true });
    fs.writeFileSync(PROGRESS, JSON.stringify(progress));
    writeHeroIndex();
    writePaths();
    sinceSave = 0;
  };

  let idx = 0;
  const worker = async () => {
    while (idx < pending.length) {
      const t = pending[idx++];
      const n = ++done;
      const base = { name: t.name, categoryId: t.categoryId, styleLabel: t.styleLabel || null, stamp: t.stamp };
      try {
        const buf = await fetchBuf(fileUrl(t.categoryId, t.fileRef));
        const r = fingerprintBuf(buf, t.fileRef, t.categoryId);
        progress.processed[keyOf(t)] = { ...base, fp: r ? r.fp : null, type: r ? r.type : null, hashes: r && t.categoryId === 'fonts' ? r.hashes : undefined, subjects: r ? r.subjects : undefined, kind: r ? r.kind : undefined, paths: r ? (r.paths ?? null) : null, error: r ? null : 'no content to fingerprint' };
        if (r) { ok++; console.log(`[${n}/${pending.length}] ok   ${r.fp.slice(0, 8)} ${r.type === 'files' ? '(files)' : '       '} ${t.name}${t.styleLabel ? ` [${t.styleLabel}]` : ''}`); }
        else { skip++; console.log(`[${n}/${pending.length}] skip (empty)  ${t.name}`); }
      } catch (e) {
        fail++;
        progress.processed[keyOf(t)] = { ...base, fp: null, type: null, error: String(e.message || e) };
        console.log(`[${n}/${pending.length}] FAIL ${t.name}: ${e.message || e}`);
      }
      if (++sinceSave >= 15) save();
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONC, pending.length || 1) }, worker));
  save();

  const fpCount = Object.keys(loadJson(OUT, { mods: {} }).mods).length;
  console.log(`\ndone. ok=${ok} skip=${skip} fail=${fail}. unique fingerprints=${fpCount}. -> ${OUT}`);
  if (fail) console.log('some downloads failed — re-run the same command to retry just those.');
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });

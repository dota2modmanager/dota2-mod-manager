#!/usr/bin/env node
/**
 * What Dota would see in a game folder, without Dota.
 *
 * The app's promises about the game folder are checked piecemeal by unit tests: the patcher
 * writes the right search path, the VPK writer writes a file its reader reads, the schema patch
 * parses. Nothing checked the folder as the game meets it, all at once, after a real sequence of
 * clicks. This does, as a model of the loader:
 *
 *   1. mounts: the search paths from gameinfo_branchspecific.gi (or gameinfo.gi), in order, with
 *      *LANGUAGE* resolved the way src/gamelang.ts resolves it for the app, keeping the folders
 *      that exist;
 *   2. packs: every pakNN_dir.vpk in every mounted folder opens, and in the ones that are ours
 *      (not Valve's pak01) every file's bytes match the CRC its index claims;
 *   3. winners: for each path, the first mounted folder that has it, and inside a folder the
 *      lowest pak number, which is the rule src/installer.js places mods by;
 *   4. schema: the items_game.txt the game would read parses, and every model, particle and
 *      material a changed block points at exists somewhere the game can load it from;
 *   5. signatures: when the search paths are ours, dota.signatures carries a line for the
 *      branch file as it is now, which is what matchmaking checks.
 *
 * It is a model: where the real engine is found to disagree, the engine is right and this is
 * wrong, and the place to write that down is here. Nothing is written to the game folder.
 *
 *   node tools/sim/dota.js [gamePath] [--json]
 */
const fs = require('fs');
const path = require('path');
const { crc32 } = require('zlib');
const { openVpkIndex, listVpkPathCrcsFile } = require('../../src/vpk.ts');
const patcher = require('../../src/patcher.ts');
const gamelang = require('../../src/gamelang.ts');

const SCHEMA_REL = 'scripts/items/items_game.txt';
const VALVE_PAK = /^pak01_dir\.vpk$/i;

/** The search path lines, in order: [{ key, value }]. The branch file wins when it has a block. */
function searchPaths(gamePath) {
  const p = patcher.paths(gamePath);
  const read = (f) => { try { return fs.readFileSync(f, 'latin1'); } catch { return null; } };
  const branch = read(p.branch);
  const base = read(p.gameinfo);
  let block = null;
  for (const text of [branch, base]) {
    if (!text || !text.includes('SearchPaths')) continue;
    try { block = patcher.searchPathsBlock(text); break; } catch { /* no block in this one */ }
  }
  if (!block) return [];
  return block.split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l && !/^SearchPaths$|^[{}]$/.test(l))
    .map((l) => { const [key, value] = l.split(/\s+/); return { key, value }; })
    .filter((e) => e.key && e.value);
}

/** The language the engine mounts, by the app's own reading of boot.vcfg and launch options. */
function mountedLanguage(gamePath) {
  const detected = gamelang.detectLangSuffix(gamePath);
  return gamelang.modFolderFor(gamelang.launchLanguage(gamePath), detected.audio || detected.suffix).suffix;
}

/** Game folders in mount order, existing ones only. Low violence is never mounted by default. */
function mountOrder(gamePath) {
  const lang = mountedLanguage(gamePath);
  const seen = new Set();
  const out = [];
  for (const { key, value } of searchPaths(gamePath)) {
    if (key !== 'Game' && key !== 'Game_Language') continue;
    const folder = value.replace('*LANGUAGE*', lang);
    if (seen.has(folder) || !fs.existsSync(path.join(gamePath, folder))) continue;
    seen.add(folder);
    out.push(folder);
  }
  return out;
}

/** The pakNN_dir.vpk files in a folder, lowest number first. */
function paksIn(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => /^pak\d+_dir\.vpk$/i.test(n)).sort((a, b) => parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10));
}

/** Whether one pack opens, and for ours whether every file matches its CRC. */
function inspectPak(file, { verifyBytes = true } = {}) {
  const out = { file, ok: true, entries: 0, errors: [] };
  let index;
  try {
    index = openVpkIndex(file);
    out.entries = index.size;
  } catch (e) {
    out.ok = false;
    out.errors.push(`does not open: ${e.message}`);
    return out;
  }
  if (!verifyBytes) return out;
  try {
    for (const [rel, crc] of listVpkPathCrcsFile(file)) {
      const data = index.read(rel);
      if (!data) { out.errors.push(`${rel}: listed, not readable`); continue; }
      if ((crc32(data) >>> 0) !== (crc >>> 0)) out.errors.push(`${rel}: bytes do not match the CRC in the index`);
      if (out.errors.length > 20) break;
    }
  } catch (e) {
    out.errors.push(`bytes not checked: ${e.message}`);
  }
  out.ok = !out.errors.length;
  return out;
}

/**
 * The loader over a whole game folder. Returns { mounts, paks, resolve(rel) -> {folder, pak}|null,
 * read(rel) -> Buffer|null }. Valve's own pak01 is opened for lookups but not read end to end:
 * it is 25 GB behind a 22 MB index on a real install.
 */
function load(gamePath) {
  const mounts = mountOrder(gamePath);
  const paks = [];
  const openers = [];
  for (const folder of mounts) {
    const dir = path.join(gamePath, folder);
    for (const name of paksIn(dir)) {
      const file = path.join(dir, name);
      const valve = VALVE_PAK.test(name);
      paks.push({ folder, name, valve, ...inspectPak(file, { verifyBytes: !valve }) });
      try { openers.push({ folder, name, index: openVpkIndex(file) }); } catch { /* reported above */ }
    }
  }
  const resolve = (rel) => {
    const want = String(rel).toLowerCase().replace(/\\/g, '/');
    for (const o of openers) if (o.index.has(want)) return { folder: o.folder, pak: o.name };
    for (const folder of mounts) if (fs.existsSync(path.join(gamePath, folder, want))) return { folder, pak: null };
    return null;
  };
  const read = (rel) => {
    const want = String(rel).toLowerCase().replace(/\\/g, '/');
    for (const o of openers) if (o.index.has(want)) return o.index.read(want);
    for (const folder of mounts) {
      const f = path.join(gamePath, folder, want);
      if (fs.existsSync(f)) return fs.readFileSync(f);
    }
    return null;
  };
  return { mounts, paks, resolve, read };
}

/* An item block per entry of "items", split on the line that opens one (two tabs, a quoted
   number); the file ships with Windows line ends, which the first version of this missed and so
   saw the whole schema as one block. */
function blocksOf(text) {
  return text.replace(/\r\n/g, '\n').split(/\n(?=\t\t"\d+"\n)/);
}

/** items_game.txt out of Valve's own pak01 in dota/, or null. */
function valveSchema(gamePath) {
  try {
    const data = openVpkIndex(path.join(gamePath, 'dota', 'pak01_dir.vpk')).read(SCHEMA_REL);
    return data ? data.toString('utf8') : null;
  } catch { return null; }
}

/* Asset paths a block of items_game points at: models, particles, materials. Compiled names
   end in _c on disk (a .vmdl is shipped as .vmdl_c). */
function assetRefs(block) {
  const out = new Set();
  for (const m of block.matchAll(/"((?:models|particles|materials)\/[^"]+\.(?:vmdl|vpcf|vmat|vtex))"/gi)) {
    out.add(`${m[1].toLowerCase().replace(/\\/g, '/')}_c`);
  }
  return [...out];
}

/**
 * Everything at once, as the game would meet it. `vanillaSchema` is Valve's items_game text, to
 * tell the blocks the app changed from the ones it did not; without it every block is checked,
 * which on a real install is slow but not wrong.
 */
function checkGame(gamePath, { vanillaSchema = null } = {}) {
  const game = load(gamePath);
  const report = { gamePath, mounts: game.mounts, paks: game.paks.map(({ index, ...p }) => p), problems: [], schema: null, signatures: null };
  for (const p of game.paks) if (!p.ok) report.problems.push(`${p.folder}/${p.name}: ${p.errors.slice(0, 3).join('; ')}`);

  const where = game.resolve(SCHEMA_REL);
  if (where) {
    const text = game.read(SCHEMA_REL).toString('utf8');
    const schema = { from: `${where.folder}/${where.pak || '(loose)'}`, bytes: text.length, checkedBlocks: 0, missing: [] };
    const opens = (text.match(/{/g) || []).length;
    const closes = (text.match(/}/g) || []).length;
    if (opens !== closes) report.problems.push(`items_game from ${schema.from} has ${opens} "{" and ${closes} "}"`);
    /* Valve's own copy is the baseline unless one is given: the blocks worth checking are the ones
       the app changed. When the game reads Valve's copy, nothing was changed and nothing is checked. */
    const valveWins = where.folder === 'dota' && where.pak && VALVE_PAK.test(where.pak);
    const baseline = vanillaSchema ?? (valveWins ? text : valveSchema(gamePath));
    const vanilla = baseline ? new Set(blocksOf(baseline)) : null;
    for (const block of blocksOf(text)) {
      if (vanilla && vanilla.has(block)) continue;
      schema.checkedBlocks++;
      for (const ref of assetRefs(block)) if (!game.resolve(ref)) schema.missing.push(ref);
    }
    schema.missing = [...new Set(schema.missing)];
    if (vanilla && schema.missing.length) report.problems.push(`${schema.missing.length} asset(s) a changed item block points at are nowhere the game can load them: ${schema.missing.slice(0, 5).join(', ')}`);
    report.schema = schema;
  }

  const st = patcher.state(gamePath, null);
  report.signatures = { patched: st.patched, signed: st.signed, signable: st.signable };
  if (st.patched && st.signable && !st.signed) report.problems.push('the search paths are ours but dota.signatures has no line for the branch file: matchmaking would refuse');
  report.ok = !report.problems.length;
  return report;
}

module.exports = { searchPaths, mountedLanguage, mountOrder, paksIn, inspectPak, load, assetRefs, blocksOf, checkGame };

if (require.main === module) {
  const game = process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : path.join(__dirname, '..', '..', 'sandbox', 'steamapps', 'common', 'dota 2 beta', 'game');
  const r = checkGame(game);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 1)); } else {
    console.log(`mounts: ${r.mounts.join(' > ')}`);
    for (const p of r.paks) console.log(`  ${p.ok ? 'ok  ' : 'BAD '} ${p.folder}/${p.name} ${p.entries} files${p.valve ? ' (Valve, index only)' : ''}`);
    if (r.schema) console.log(`items_game from ${r.schema.from}, ${r.schema.checkedBlocks} block(s) checked, ${r.schema.missing.length} missing asset(s)`);
    console.log(`search paths ours: ${r.signatures.patched}, signed: ${r.signatures.signed}`);
    console.log(r.ok ? 'The game would load this folder.' : `Problems:\n  - ${r.problems.join('\n  - ')}`);
  }
  process.exit(r.ok ? 0 : 1);
}

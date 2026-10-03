// What is already installed, read and rewritten: what a mod is, its files merged into one or
// written out as a folder, the whole-game tables stripped out of it, a pack of heroes split.
// Taking a mod IN - from a file, a zip, a folder or dropped bytes - is src/import.ts.
// Behind src/installer.ts.
import fs from 'node:fs';
import path from 'node:path';
import {
  listVpkPaths, listVpkPathsFile, readVpkIndexFile, readVpkEntries, entryPath, buildVpk, mergeVpkToSingle,
  splitVpkByHero, analyzeVpkPaths, describeAnalysis, nameFromAnalysis, subjectHeroes, fingerprintVpk, entryAt,
} from './vpk.ts';
import { extractDeltas, deltaTable } from './schema.ts';
import { safeJoin } from './safe-zip.ts';
import { t } from './i18n.ts';
import { MASTER_OFF, MERGE_SIZE_CAP } from './installer-files.ts';
import type { Installer } from './installer.ts';
import type { Library } from './library.ts';
import type { LibFile, HasFiles } from './types.ts';
import type { Analysis } from './vpk.ts';
import type { SchemaDelta } from './schema.ts';

/** What a record's own file is: a summary, the heroes it is about, the game's names for it, its fingerprint. */
type RecordAnalysis = {
  info: string; heroes: number; subjects: number; items?: string[]; heroNames: string[]; fp: string;
};

// Whole-game tables and tool branding that packaging tools bake into EVERY export.
// Dota 2 Skinchanger, for one, ships a full 47 MB scripts/items/items_game.txt plus the
// localization files, its loadout stylesheets, its logo strip and a steam-id watermark in
// every single pack it builds. None of it belongs in a language folder - the localization
// copy in particular outranks the game's own and rolls UI text back to whenever the pack
// was built - so harvestSchema strips them on the way in.
const GLOBAL_TABLE_RE = new RegExp('^(?:' + [
  'scripts/items/items_game(?:\\.txt)?"?$',            // the game's whole item table
  'resource/localization/',                            // full dota_<lang>.txt copies
  'panorama/styles/(?:hero_slot_item_picker_loadout|ui_econ_item)\\.vcss_c"?$',
  'panorama/images/(?:ds|tg|tt|wb|yu|remove|header_credits|footer_credits)[^/]*$',
  '(?:models/heroes|panorama)/\\d{8,}\\.vxml_c"?$',    // <steam id>.vxml_c watermark
].join('|') + ')');

// Above this a resource/localization file is the game's whole table rather than a mod's own
// few lines: Dota's own dota_english.txt is ~4 MB, a deliberate edit is a few KB.
const LOC_COPY_MIN = 256 * 1024;

/**
 * What a path list is, told as precisely as this machine allows: the game's own item names
 * when it recognises them, the guess from the paths otherwise. The two are merged rather
 * than one replacing the other - a mod can dress a hero in named items AND replace another
 * hero's bare body, and only the guess sees the second.
 */
export function describePaths(inst: Installer, paths: string[], analysis: Analysis): { info: string; heroNames: string[]; items?: string[] } {
  const out: { info: string; heroNames: string[]; items?: string[] } = { info: describeAnalysis(analysis), heroNames: analysis.heroes.map((h) => h.name) };
  let named = null;
  try { named = inst.identify(paths); } catch { /* no game, no table: the guess stands */ }
  if (!named) return out;
  out.items = named.items;
  // the table is the authority on who wears what, so a hero it never mentions and the mod
  // carries no model for was a borrowed texture, not a subject
  const carried = new Set(subjectHeroes(analysis).map((h) => h.name));
  for (const h of named.heroNames) carried.add(h);
  out.heroNames = [...carried];
  out.info = named.items.length <= 3
    ? named.items.join(', ')
    : `${named.items.slice(0, 2).join(', ')} +${named.items.length - 2}`;
  return out;
}

/**
 * A mod's lang files (including multi-part _dir + _NNN sets) merged into one
 * self-contained VPK buffer - the single-file format the catalog uses, e.g. for sharing
 * an imported Dota2Changer pack with a catalog author.
 * @param {object} rec
 * @param {Array<{id, name, block}>} [deltas]  the record's lifted item blocks, for a file
 *   headed somewhere other than this install (an export, a shared preset). Installing
 *   strips the table a mod ships and keeps its blocks on the record instead, so without
 *   these the copy leaves without its effects - see harvestSchema / schema.deltaTable.
 */
export function mergeToSingleVpk(inst: Installer, rec: HasFiles, deltas?: { block: string }[] | null): Buffer {
  const lang = inst.langFolder();
  const dirRec = rec.files.find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
  if (!dirRec) throw new Error(t('У этого мода нет _dir.vpk — объединять нечего'));
  // resolve real on-disk name (files may be disabled -> ".off")
  const resolve = (relPath: string) => {
    const abs = path.join(lang, relPath);
    for (const suf of ['', '.off', MASTER_OFF]) if (fs.existsSync(abs + suf)) return abs + suf;
    return abs;
  };
  const dirAbs = resolve(dirRec.relPath);
  const base = dirRec.relPath.replace(/_dir\.vpk$/i, '');
  const archivePathFor = (idx: number) => resolve(`${base}_${String(idx).padStart(3, '0')}.vpk`);
  if (!deltas || !deltas.length) return mergeVpkToSingle(dirAbs, archivePathFor);

  const entries = readVpkEntries(fs.readFileSync(dirAbs), dirAbs, archivePathFor)
    .filter((e) => !/(^|\/)items_game\.txt"?$/.test(entryPath(e)));
  // latin1 keeps the blocks byte-exact, the way the whole schema path reads and writes them
  const data = Buffer.from(deltaTable(deltas), 'latin1');
  entries.push(entryAt('scripts/items/items_game.txt', data));
  return buildVpk(entries);
}

//
// Taking a mod IN - from a file, a zip, a folder or bytes off a drop - moved to
// src/import.ts. What is left here works on what the folder already holds.
/**
 * The inverse of packing a folder: write a mod's own files out as a tree, so the author
 * who wants to change one texture can open it, edit it, and drop the folder back in.
 * Multi-volume sets are followed, exactly as exporting to one file does.
 * @returns {{ files: number, bytes: number }}
 */
export function unpackToFolder(inst: Installer, rec: HasFiles, dest: string): { files: number; bytes: number } {
  const dirRec = (rec.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
  if (!dirRec) throw new Error(t('У этого мода нет _dir.vpk — распаковывать нечего'));
  const dirAbs = inst.langFileOnDisk(dirRec.relPath);
  const base = dirRec.relPath.replace(/_dir\.vpk$/i, '');
  const archivePathFor = (idx: number) => inst.langFileOnDisk(`${base}_${String(idx).padStart(3, '0')}.vpk`);
  const entries = readVpkEntries(fs.readFileSync(dirAbs), dirAbs, archivePathFor);

  let bytes = 0;
  for (const en of entries) {
    const rel = entryPath(en);
    // the archive names the file, so the archive could name a path outside the folder;
    // safeJoin is the same guard foreign zips go through (see src/safe-zip.ts)
    const out = safeJoin(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const data = en.data.length ? en.data : en.preload;
    fs.writeFileSync(out, data);
    bytes += data.length;
  }
  return { files: entries.length, bytes };
}

// A content-derived display name for a lang VPK (hero / set / kind), or null if the
// content isn't recognisable — used to name imported files instead of a bare "pakNN".
export function displayNameForFile(inst: Installer, relPath: string): string | null {
  try {
    return nameFromAnalysis(analyzeVpkPaths(listVpkPathsFile(inst.langFileOnDisk(relPath))));
  } catch { return null; }
}

/**
 * Take the whole-game tables out of a freshly installed mod and keep what they meant.
 *
 * Skinchanger-style packs ship a full copy of scripts/items/items_game.txt and of the
 * localization files - tens of MB of stale game data per mod. The schema copy is dead
 * weight in a language folder (the engine reads that file through the MOD path only),
 * and the localization copy is worse than dead: it outranks the game's own and rolls
 * text back to whenever the pack was built. So: lift the item blocks the mod actually
 * changed, then repack the VPK without any of those tables.
 *
 * @param {Array<{root: string, relPath: string}>} records  install records, edited in place
 * @param {string} vanillaText  the game's current items_game.txt
 * @returns {{ deltas: Array<{id, name, block}>, stripped: string[] }}
 */
export function harvestSchema(inst: Installer, records: LibFile[], vanillaText: string | null): { deltas: SchemaDelta[]; stripped: string[] } {
  const lang = inst.langFolder();
  const deltas: SchemaDelta[] = [];
  const stripped: string[] = [];
  for (const rec of records) {
    if (rec.root !== 'lang' || !/_dir\.vpk$/i.test(rec.relPath)) continue;
    const abs = path.join(lang, rec.relPath);
    if (!fs.existsSync(abs)) continue;
    let paths: string[];
    try { paths = listVpkPathsFile(abs); } catch { continue; }
    if (!paths.some((p) => GLOBAL_TABLE_RE.test(p))) continue;

    const base = rec.relPath.replace(/_dir\.vpk$/i, '');
    const partRe = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{3}\\.vpk$`, 'i');
    const parts = fs.readdirSync(lang).filter((f) => partRe.test(f));
    const total = [abs, ...parts.map((f) => path.join(lang, f))].reduce((n, f) => n + fs.statSync(f).size, 0);
    if (total > MERGE_SIZE_CAP) continue; // repacking holds the mod in memory once

    let entries: ReturnType<typeof readVpkEntries>;
    try { entries = readVpkEntries(fs.readFileSync(abs), abs); } catch { continue; }
    const schemaEntry = entries
      .filter((e) => /(^|\/)items_game\.txt"?$/.test(entryPath(e)))
      .sort((a, b) => b.data.length - a.data.length)[0];
    // Any size: a mod off the internet ships the whole 47 MB table, but a mod exported by
    // this app carries only its own blocks (see mergeToSingleVpk), and that file is small.
    if (schemaEntry && schemaEntry.data.length && vanillaText) {
      try {
        for (const d of extractDeltas(schemaEntry.data.toString('latin1'), paths, vanillaText)) deltas.push(d);
      } catch { /* a mangled table is not worth failing the install over */ }
    }

    // A localization file the size of the game's own is a stale copy of it; a small one
    // is a deliberate edit (a mod renaming an item), and that we keep.
    const drop = (e: (typeof entries)[number]) => {
      const p = entryPath(e);
      if (!GLOBAL_TABLE_RE.test(p)) return false;
      if (/^resource\/localization\//.test(p) && e.data.length < LOC_COPY_MIN) return false;
      return true;
    };
    const keep = entries.filter((e) => !drop(e));
    if (keep.length === entries.length) continue;
    fs.writeFileSync(abs, buildVpk(keep));
    for (const f of parts) fs.rmSync(path.join(lang, f), { force: true });
    stripped.push(rec.relPath);
  }
  // volume files are folded into the single-file rebuild above
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.root === 'lang' && /_\d{3}\.vpk$/i.test(r.relPath) && !fs.existsSync(path.join(lang, r.relPath))) {
      records.splice(i, 1);
    }
  }
  return { deltas, stripped };
}

// Bytes a record occupies in the language folder (its pak plus any data volumes).
export function installedSize(inst: Installer, rec: HasFiles): number {
  const lang = inst.langFolder();
  let total = 0;
  for (const f of rec.files || []) {
    if (f.root !== 'lang') continue;
    const abs = path.join(lang, f.relPath);
    try { total += fs.statSync(abs).size; } catch { /* removed by hand */ }
  }
  return total;
}

// What a stored library record (or a foreign vpk) actually changes — hero(es) and
// slots — read from its _dir.vpk on disk. Returns { info, heroes } or null.
export function analyzeRecord(inst: Installer, rec: HasFiles): RecordAnalysis | null {
  const dir = rec.files.find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
  if (!dir) return null;
  try {
    const buf = readVpkIndexFile(inst.langFileOnDisk(dir.relPath));
    const paths = listVpkPaths(buf);
    const a = analyzeVpkPaths(paths);
    const told = inst.describePaths(paths, a);
    return {
      info: told.info, heroes: a.heroes.length,
      // What the file is actually about — the heroes it could be split into. Every hero it
      // merely mentions counts for the summary, not for splitting, and neither does one it
      // borrowed a prop from: subjectHeroes is what draws that line, and drawing it here a
      // second time is how a Clinkz set with a Phoenix immortal on its bow kept splitting
      // itself in half after the line had already moved.
      subjects: subjectHeroes(a).filter((h) => h.models > 0).length,
      // the game's own names for what this replaces, when it recognises any of it
      items: told.items,
      // which hero(es) the content is for, by display name - lets the renderer show a
      // hero's own portrait as a stand-in for an import with no picture of its own
      heroNames: told.heroNames,
      fp: fingerprintVpk(buf),
    };
  } catch { return null; }
}

// Split a merged multi-hero VPK sitting in the lang folder into one managed VPK per
// hero, each written to a fresh pak slot. Returns [{ hero, name, files }]; caller
// registers them and deletes the source. Empty if fewer than 2 heroes are found.
export function splitVpkFile(inst: Installer, sourceRelPath: string): { hero: string; name: string; paths: string[]; files: LibFile[] }[] {
  const lang = inst.langFolder();
  const parts = splitVpkByHero(path.join(lang, sourceRelPath));
  if (!parts.length) return [];
  const used = inst.usedPakNames();
  return parts.map((part) => {
    const pakName = inst.allocatePak(used, false);
    inst.writeInto(part.buf, path.join(lang, pakName));
    return { hero: part.name, name: part.name, paths: part.paths, files: [{ root: 'lang', relPath: pakName }] };
  });
}

// Imports made before multi-volume sets were folded on the way in still sit in the
// folder as pakNN_dir.vpk + pakNN_000.vpk. Fold them now so every managed mod is one
// file. Combined packs are left alone — their volumes are how deployPack writes them.
export function mergeMultiPartRecords(inst: Installer, library: Pick<Library, 'list' | 'update'>): void {
  const lang = inst.langFolder();
  if (!fs.existsSync(lang)) return;
  const onDisk = (relPath: string) => ['', '.off', MASTER_OFF]
    .map((suf) => path.join(lang, relPath) + suf).find((p) => fs.existsSync(p));

  // No `changed` flag and no save at the end: library.update() below persists each record
  // as it is folded, which is what the sibling above needs a flag for and this does not.
  for (const rec of library.list()) {
    if (rec.kind === 'pack') continue;
    const dirRec = (rec.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
    const parts = (rec.files || []).filter((f) => f.root === 'lang' && /_\d{3}\.vpk$/i.test(f.relPath));
    if (!dirRec || !parts.length) continue;
    const dirAbs = onDisk(dirRec.relPath);
    if (!dirAbs) continue;
    try {
      const base = dirRec.relPath.replace(/_dir\.vpk$/i, '');
      const total = parts.reduce((s, f) => { const p = onDisk(f.relPath); return s + (p ? fs.statSync(p).size : 0); }, 0);
      if (total > MERGE_SIZE_CAP) continue;
      // a volume that is not there fails the read below, and the set is left as it is
      const merged = mergeVpkToSingle(dirAbs, (idx) => onDisk(`${base}_${String(idx).padStart(3, '0')}.vpk`) as string);
      // write beside the original and swap, so a failed write can't leave a mod truncated
      fs.writeFileSync(dirAbs + '.merging', merged);
      fs.renameSync(dirAbs + '.merging', dirAbs); // keeps whatever .off/.moff state it had
      for (const f of parts) {
        for (const suf of ['', '.off', MASTER_OFF]) fs.rmSync(path.join(lang, f.relPath) + suf, { force: true });
      }
      library.update(rec.id, { files: rec.files.filter((f) => !parts.includes(f)) });
    } catch { /* missing or unreadable volume — leave the set as it is */ }
  }
}

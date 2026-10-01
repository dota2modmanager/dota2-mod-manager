// The language folder as a whole: the "mods off" switch, the note of which files are ours, the
// leftovers of a transaction the app died in, and the files nobody installed through the app.
// Behind src/installer.ts.
import fs from 'node:fs';
import path from 'node:path';
import {
  listVpkPaths, readVpkIndexFile, analyzeVpkPaths, subjectHeroes, nameFromAnalysis, fingerprintVpk, fingerprintFiles,
} from './vpk.ts';
import { isMinifyFile, isMinifyPak } from './minify.ts';
import { FONTS_SUBDIR, CURSOR_SUBDIR } from './overlays.ts';
import { t } from './i18n.ts';
import { MASTER_OFF, OWNERSHIP_FILE, STAGED_RE, isOfficialLangFile } from './installer-files.ts';
import type { Installer } from './installer.ts';
import type { LibFile, LibRecord } from './types.ts';

/** A file in the game folder nobody installed through the app, as the library lists it. */
export type ForeignItem = {
  kind: 'vpk' | 'cursor'; key: string; name: string; fileName?: string; primary: boolean; size: number;
  enabled: boolean; files: LibFile[]; info?: string; heroes?: number; subjects?: number; items?: string[];
  heroNames?: string[]; kindTag?: string; fp?: string;
};

// Is this base name a mod pak the master switch may toggle? (i.e. not the game's own
// localization / gameinfo). Accepts a lowercased name without .off/.moff suffix.
/* What the master switch is allowed to rename.
 *
 * Not the game's own files, and not Minify's: the switch sweeps the folder rather than
 * asking the library, so in the arrangement we recommend - both apps sharing one language
 * folder - "mods off" would rename pak65 to pak67 out from under it and Minify would find
 * its own work missing. Ours are the only mods this switch has any business touching.
 */
export function isTogglableModFile(inst: Installer, baseLower: string): boolean {
  return !isOfficialLangFile(baseLower) && !isMinifyFile(baseLower) && baseLower !== OWNERSHIP_FILE;
}

// true when the master switch is currently "off" (any .moff file present in lang root)
export function masterIsOff(inst: Installer): boolean {
  const lang = inst.langFolder();
  if (!fs.existsSync(lang)) return false;
  for (const f of fs.readdirSync(lang)) if (f.toLowerCase().endsWith(MASTER_OFF)) return true;
  return false;
}

// Enable/disable every mod pak at once without losing per-mod state:
//  off -> rename each active mod file <f> to <f>.moff (skips .off and official files)
//  on  -> rename each <f>.moff back to <f>
// Also covers the language\maps folder (terrain mods live there as dota.vpk).
export function setMasterEnabled(inst: Installer, enabled: boolean): { changed: number } {
  const lang = inst.langFolder();
  if (!fs.existsSync(lang)) return { changed: 0 };
  let changed = 0;
  const sweep = (dir: string): void => {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (!fs.statSync(full).isFile()) continue;
      const lower = f.toLowerCase();
      if (enabled) {
        if (lower.endsWith(MASTER_OFF)) {
          fs.renameSync(full, path.join(dir, f.slice(0, -MASTER_OFF.length)));
          changed++;
        }
      } else {
        if (lower.endsWith(MASTER_OFF) || lower.endsWith('.off')) continue; // already off
        if (dir === lang && !inst.isTogglableModFile(lower)) continue;       // official files
        fs.renameSync(full, full + MASTER_OFF);
        changed++;
      }
    }
  };
  sweep(lang);
  const mapsDir = path.join(lang, 'maps');
  if (fs.existsSync(mapsDir)) sweep(mapsDir);
  return { changed };
}

/**
 * Say on disk which files in the language folder are this app's.
 *
 * Rewritten from the library rather than appended to, so a mod removed outside the app
 * drops out on the next write instead of lingering as a claim on a file we do not have.
 * Never fails an operation: an unwritable game folder is a problem for installing, not for
 * a note about installing.
 * @param {string[]} relPaths every lang-root relPath the library holds
 */
export function writeOwnership(inst: Installer, relPaths: string[] | null | undefined): void {
  try {
    const lang = inst.langFolder();
    if (!fs.existsSync(lang)) return;
    const files = [...new Set((relPaths || []).map((r) => String(r).replace(/\\/g, '/')))].sort();
    const body = {
      app: 'Dota 2 Mod Manager',
      url: 'https://dota2modmanager.com',
      note: 'Files listed here were installed by this app. Anything else in this folder is not ours.',
      updated: new Date().toISOString(),
      files,
    };
    fs.writeFileSync(path.join(lang, OWNERSHIP_FILE), JSON.stringify(body, null, 2));
  } catch { /* a note nobody can write is not worth failing an install over */ }
}

/** Whether this app installed the file at `relPath`, according to what is on disk. */
export function ownsFile(inst: Installer, relPath: string): boolean {
  try {
    const lang = inst.langFolder();
    const raw = JSON.parse(fs.readFileSync(path.join(lang, OWNERSHIP_FILE), 'utf-8')) as { files?: unknown[] };
    const want = String(relPath).replace(/\\/g, '/').toLowerCase();
    return (raw.files || []).some((f) => String(f).toLowerCase() === want);
  } catch {
    return false;
  }
}

/**
 * Clean up after a transaction that never finished, which can only mean the app was killed
 * mid-write. Two cases, and they need opposite answers:
 *   the original is missing → the parked copy IS the file, put it back (an interrupted
 *     remove or rename, e.g. switching a mod off);
 *   the original is there   → the write went through and the parked copy is the old
 *     version commit would have deleted. Left alone for a week in case somebody wants it,
 *     then dropped so the folder does not collect them.
 * @returns {{ restored: number, dropped: number }}
 */
export function sweepStaged(inst: Installer, maxAgeMs = 7 * 24 * 60 * 60 * 1000): { restored: number; dropped: number } {
  const out = { restored: 0, dropped: 0 };
  const game = inst.getGamePath();
  if (!game) return out;
  const dirs: string[] = [];
  try { dirs.push(inst.langFolder()); } catch { /* no language folder yet */ }
  dirs.push(path.join(game, ...FONTS_SUBDIR), path.join(game, ...CURSOR_SUBDIR), inst.toolsDir);
  for (const dir of dirs) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!STAGED_RE.test(name)) continue;
      const parked = path.join(dir, name);
      const original = path.join(dir, name.replace(STAGED_RE, ''));
      try {
        if (!fs.existsSync(original)) { fs.renameSync(parked, original); out.restored++; continue; }
        if (Date.now() - fs.statSync(parked).mtimeMs > maxAgeMs) { fs.rmSync(parked, { recursive: true, force: true }); out.dropped++; }
      } catch { /* locked or gone: it will be here next start too */ }
    }
  }
  return out;
}

// Does a record's primary VPK still exist on disk (active/.off/.moff)? Used to sync the
// library with the folder — a mod deleted from the folder should drop out of the library.
export function langPrimaryPresent(inst: Installer, rec: LibRecord): boolean {
  let lang: string;
  try { lang = inst.langFolder(); } catch { return true; } // no game path — can't tell, keep it
  if (!fs.existsSync(lang)) return true; // folder missing entirely — don't nuke the manifest
  const primary = (rec.files || []).find((f) => f.root === 'lang' && /\.vpk$/i.test(f.relPath));
  if (!primary) return true; // fonts/cursors/tools live elsewhere — not folder-synced
  return ['', '.off', '.moff'].some((suf) => fs.existsSync(path.join(lang, primary.relPath + suf)));
}

/**
 * Build a foreign VPK item: read enough of the file to name it, illustrate it and
 * recognise it. A file dropped into the folder by hand is the same kind of thing as an
 * import, and the library shows it that way — a bare "pak90_dir.vpk" told the user
 * nothing about what was in it, which is exactly why it looked broken.
 */
export function vpkItem(inst: Installer, abs: string, relPath: string, displayName: string, primary: boolean): ForeignItem {
  const base = relPath.replace(/\.off$/i, '');
  const item: ForeignItem = {
    kind: 'vpk', key: relPath, name: displayName, fileName: base, primary,
    size: fs.statSync(abs).size, enabled: !abs.toLowerCase().endsWith('.off'),
    files: [{ root: 'lang', relPath: base }],
  };
  // data volumes that belong to this index — they travel with it on adopt and delete
  for (const part of inst.siblingParts(base)) item.files.push({ root: 'lang', relPath: part });
  try {
    const buf = readVpkIndexFile(abs);
    const paths = listVpkPaths(buf);
    const a = analyzeVpkPaths(paths);
    const told = inst.describePaths(paths, a);
    item.info = told.info;
    item.heroes = a.heroes.length;
    item.subjects = subjectHeroes(a).filter((h) => h.models > 0).length;
    item.items = told.items;
    item.heroNames = told.heroNames;
    item.kindTag = a.kind;
    item.fp = fingerprintVpk(buf);
    // a content name ("Juggernaut", "Ландшафт") instead of the slot the file happens
    // to sit in; the file name stays on the row as the sub-label
    item.name = nameFromAnalysis(a) || displayName;
  } catch { /* data part / unreadable — leave untagged, keep the file name */ }
  return item;
}

// "<base>_NNN.vpk" volumes sitting next to a "<base>_dir.vpk" in the lang folder
export function siblingParts(inst: Installer, dirRelPath: string): string[] {
  if (!/_dir\.vpk$/i.test(dirRelPath)) return [];
  const lang = inst.langFolder();
  const dir = path.dirname(path.join(lang, dirRelPath));
  const prefix = path.basename(dirRelPath).replace(/_dir\.vpk$/i, '');
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{3}\\.vpk$`, 'i');
  const sub = path.dirname(dirRelPath);
  try {
    return fs.readdirSync(dir)
      .filter((f) => re.test(f.replace(/\.off$/i, '')))
      .map((f) => (sub === '.' ? f : `${sub}/${f}`).replace(/\.off$/i, ''));
  } catch { return []; }
}

// Foreign content — files not installed through the app — across every place a mod
// can live: the language folder root (skins, imported), language\maps (terrains), and
// resource\cursor (a cursor set, treated as one item). Each carries a fingerprint so
// the caller can recognise it as a specific catalog mod. `primary` items (lang root)
// are always listed; maps/cursor items are only worth showing when they match, so the
// caller passes scanExtras=false to skip that scan when it has nothing to match against.
export function externalFiles(inst: Installer, knownFiles: LibFile[], { scanExtras = true }: { scanExtras?: boolean } = {}): ForeignItem[] {
  const game = inst.getGamePath();
  if (!game) return [];
  const knownLang = new Set(knownFiles.filter((f) => f.root === 'lang').map((f) => f.relPath.toLowerCase()));
  const knownCursor = knownFiles.some((f) => f.root === 'cursor');
  const out: ForeignItem[] = [];

  const lang = inst.langFolder();
  if (fs.existsSync(lang)) {
    const names = fs.readdirSync(lang);
    // a "<base>_NNN.vpk" volume is part of its "<base>_dir.vpk", not a mod of its own:
    // listing it separately gave the user rows they could neither name nor act on
    const indexed = new Set<string>();
    for (const f of names) {
      const b = f.toLowerCase().replace(/\.off$/, '');
      const m = b.match(/^(.*)_dir\.vpk$/);
      if (m) indexed.add(m[1]);
    }
    for (const f of names) {
      const full = path.join(lang, f);
      if (!fs.statSync(full).isFile()) continue;
      if (f.toLowerCase().endsWith(MASTER_OFF)) continue; // master-off files: handled by the toggle, not foreign
      if (STAGED_RE.test(f)) continue; // a file a transaction parked; sweepStaged deals with those
      const base = f.toLowerCase().replace(/\.off$/, '');
      if (isOfficialLangFile(base) || knownLang.has(base)) continue;
      if (base === OWNERSHIP_FILE) continue; // our own note about which files are ours
      // Minify's output, in a folder both apps share: listing it here would offer the user
      // buttons to adopt, disable and delete another program's files. By slot for the three
      // it reserves, and by the marker it packs into everything it builds, which covers a
      // version that ever uses a different number.
      if (isMinifyFile(base) || isMinifyPak(full)) continue;
      const part = base.match(/^(.*)_\d{3}\.vpk$/);
      if (part && indexed.has(part[1])) continue;
      out.push(inst.vpkItem(full, f, f, true));
    }
    // terrains ship as language\maps\dota.vpk (not a *_dir.vpk in the root)
    const mapsDir = path.join(lang, 'maps');
    if (scanExtras && fs.existsSync(mapsDir)) {
      for (const f of fs.readdirSync(mapsDir)) {
        if (!/\.vpk$/i.test(f)) continue;
        const rel = `maps/${f}`;
        if (knownLang.has(rel.toLowerCase().replace(/\.off$/, ''))) continue;
        /* A terrain and a Minify map mod are the same file - maps/dota.vpk - so there is no
         * slot to reserve here and nothing to tell them apart except the marker Minify packs
         * into what it builds. A hand-installed terrain has no marker and stays listed: the
         * user should be able to see and remove that one. */
        if (isMinifyPak(path.join(mapsDir, f))) continue;
        out.push(inst.vpkItem(path.join(mapsDir, f), rel, rel, false));
      }
    }
  }

  // a foreign cursor set (only when the app isn't already managing cursors)
  if (scanExtras && !knownCursor) {
    const cursorDir = path.join(game, ...CURSOR_SUBDIR);
    if (fs.existsSync(cursorDir)) {
      const files: { path: string; data: Buffer }[] = [];
      const rels: string[] = [];
      const walk = (d: string, pre: string): void => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          const rel = pre ? `${pre}/${e.name}` : e.name;
          if (e.isDirectory()) walk(full, rel);
          else if (e.isFile()) { files.push({ path: e.name.toLowerCase(), data: fs.readFileSync(full) }); rels.push(rel); }
        }
      };
      try { walk(cursorDir, ''); } catch { /* unreadable */ }
      if (files.length) {
        out.push({
          kind: 'cursor', key: '__cursor__', name: t('Курсор'), primary: false,
          size: files.reduce((s, x) => s + x.data.length, 0), enabled: true,
          files: rels.map((rp) => ({ root: 'cursor', relPath: rp })), fp: fingerprintFiles(files),
        });
      }
    }
  }
  return out;
}

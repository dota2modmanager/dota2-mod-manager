// Writing a mod into the game folder and taking it out again (src/installer.ts is the door): a
// catalog archive unpacked into the language folder, a tool into the app's own folder, a mod's
// files switched on and off, and removed with Valve's own put back where a font or cursor sat.
// Whatever touches several files runs as one transaction (src/file-tx.ts).
import fs from 'node:fs';
import path from 'node:path';
import { openZip, safeJoin } from './safe-zip.ts';
import { FileTx, type Writer } from './file-tx.ts';
import * as zones from './slot-zones.ts';
import { MASTER_OFF } from './installer-files.ts';
import type { Installer } from './installer.ts';
import type { LibFile } from './types.ts';

/** The writing half of install, inside the transaction it is handed. */
export function installInto(inst: Installer, tx: Writer, { categoryId, modName, local }: { categoryId: string; modName: string; local: string }): LibFile[] {
  const isPriority = zones.PRIORITY_CATEGORIES.includes(categoryId);
  if (categoryId === 'fonts') return inst.overlays.installFonts(local, modName, tx);
  if (categoryId === 'cursors') return inst.overlays.installCursor(local, modName, tx);
  if (categoryId === 'tools') return inst.installTool(local, modName, tx);

  const lang = inst.langFolder();
  inst.ensureLangFolder();
  const used = inst.usedPakNames();
  const records: LibFile[] = [];

  if (local.toLowerCase().endsWith('.vpk')) {
    const pakName = inst.allocatePak(used, isPriority);
    inst.copyInto(local, path.join(lang, pakName), tx);
    records.push({ root: 'lang', relPath: pakName });
    return records;
  }

  if (!local.toLowerCase().endsWith('.zip')) {
    // unknown single file — drop into lang folder as-is
    const base = path.basename(local);
    inst.copyInto(local, path.join(lang, base), tx);
    records.push({ root: 'lang', relPath: base });
    return records;
  }

  const archive = openZip(local, { label: modName });
  const kept = archive.files.filter((file) => {
    const lower = file.path.toLowerCase();
    const baseName = lower.split('/').pop();
    return !!baseName && !lower.includes('!guide')
      && !/(^|\/)(guide\.txt|install\.bat|uninstall\.bat|readme[^/]*)$/i.test(lower);
  });
  // slots for the archive's VPKs, decided before a byte is written (see planPakNames).
  // A "maps/..." payload is not a pak: terrains and the mods that come with them replace
  // the map file itself, which only works from maps\dota.vpk (the same rule the importer
  // reads by), so those keep their path.
  const isMapsPath = (l: string) => /(^|\/)maps\//.test(l);
  const pakPlan = inst.planPakNames(
    kept.map((f) => f.path).filter((rel) => /\.vpk$/i.test(rel) && !isMapsPath(rel.toLowerCase())),
    used, isPriority,
  );

  for (const file of kept) {
    const rel = file.path;
    const lower = rel.toLowerCase();
    const pakName = pakPlan.get(rel);

    if (isMapsPath(lower)) {
      // keep maps/... structure inside the language folder
      const parts = rel.split('/');
      const mapsIdx = parts.findIndex((p) => p.toLowerCase() === 'maps');
      const relPath = parts.slice(mapsIdx).join('/');
      inst.writeInto(file.read(), safeJoin(lang, relPath), tx);
      records.push({ root: 'lang', relPath });
    } else if (pakName) {
      inst.writeInto(file.read(), safeJoin(lang, pakName), tx);
      records.push({ root: 'lang', relPath: pakName });
    } else {
      // any other payload file — preserve relative path inside lang folder,
      // stripping the zip's top-level "<Mod Name>/" wrapper if present
      const parts = rel.split('/');
      const relPath = parts.length > 1 ? parts.slice(1).join('/') : rel;
      if (!relPath) continue;
      inst.writeInto(file.read(), safeJoin(lang, relPath), tx);
      records.push({ root: 'lang', relPath });
    }
  }
  return records;
}

/** A tool from the catalog, unpacked into the app's own folder rather than the game's. */
export function installTool(inst: Installer, localZip: string, modName: string, tx: Writer = null): LibFile[] {
  const dest = path.join(inst.toolsDir, modName.replace(/[<>:"/\\|?*]/g, '_'));
  fs.mkdirSync(dest, { recursive: true });
  if (localZip.toLowerCase().endsWith('.zip')) {
    openZip(localZip, { label: modName }).extractTo(dest, tx);
  } else {
    inst.copyInto(localZip, path.join(dest, path.basename(localZip)), tx);
  }
  return [{ root: 'tools', relPath: path.basename(dest) }];
}

/**
 * Switch a mod's files on or off. recId is needed for cursor sets (see src/overlays.ts);
 * without it a cursor record is left alone.
 *
 * A mod switched half off is worse than either state: the game mounts the paks that kept
 * their name and loads a mod that is missing pieces. So the renames are one transaction -
 * if Dota grabs the third file, the first two go back to how they were.
 */
export function setEnabled(inst: Installer, files: LibFile[], enabled: boolean, recId: string | null = null): void {
  if (recId && inst.overlays.cursorFiles(files).length) {
    if (enabled) inst.overlays.deployCursor(recId, files);
    else inst.overlays.undeployCursor(recId, files);
    return;
  }
  FileTx.run((tx) => {
    for (const f of files) {
      if (f.root === 'tools') continue;
      if (f.root === 'fonts' || f.root === 'cursor') continue; // handled by reinstall/restore
      const abs = path.join(inst.rootAbs(f.root), f.relPath);
      const off = abs + '.off';
      if (enabled && fs.existsSync(off)) tx.move(off, abs);
      if (!enabled && fs.existsSync(abs)) tx.move(abs, off);
    }
  }, inst.log);
}

/**
 * Take a mod's files out. opts.recId drops the record's stored cursor copy; opts.deployed=false
 * says its files are not the ones on disk right now (it was switched off), so vanilla must not
 * be restored over whatever cursor took its place.
 */
export function remove(inst: Installer, files: LibFile[], opts: { recId?: string | null; deployed?: boolean } = {}): void {
  const { recId = null, deployed = true } = opts;
  inst.overlays.dropCursorStore(recId);
  if (!deployed) files = files.filter((f) => f.root !== 'cursor');
  // Removing is deleting files AND putting Valve's own back where a font or cursor sat on
  // top of one. Half of that leaves a mod that is gone from the library but still on disk,
  // or a game missing a font it shipped with, so it is all one change.
  FileTx.run((tx) => {
    for (const f of files) {
      const rootAbs = inst.rootAbs(f.root);
      if (f.root === 'tools') {
        tx.remove(path.join(rootAbs, f.relPath));
        continue;
      }
      const abs = path.join(rootAbs, f.relPath);
      for (const p of [abs, abs + '.off', abs + MASTER_OFF]) {
        if (fs.existsSync(p)) tx.remove(p);
      }
      if (f.root === 'fonts' || f.root === 'cursor') {
        // restore vanilla file from backup if we have one
        const backupAbs = path.join(inst.backupsDir, f.root === 'fonts' ? 'fonts' : 'cursor', f.relPath);
        if (fs.existsSync(backupAbs)) inst.copyInto(backupAbs, abs, tx);
      }
    }
  }, inst.log);
  inst.overlays.forgetWritten(files);
}

/* A mod with its item pictures taken out. A hero's arcana from the catalog often brings its own
 * Blink Dagger and Black King Bar pictures along, and those show on every hero, which a player who
 * wanted the arcana alone did not ask for (Discord, 2026-11-11). The choice stays on the record
 * (noItemIcons), and an update takes them out of the new version too (src/ipc-mods.ts). */
import fs from 'node:fs';
import path from 'node:path';
import { listVpkPathsFile, readVpkEntries, entryPath, buildVpk } from './vpk.ts';
import { MASTER_OFF } from './installer-files.ts';
import type { Installer } from './installer.ts';
import type { LibFile } from './types.ts';

/** The item pictures of the shop and the inventory (Blink Dagger's is items/blink_png.vtex_c). */
export const ITEM_ICON_RE = /^panorama\/images\/items\//;

/** A file of the language folder as it is on disk: on, off, or off with the master switch. */
const onDisk = (lang: string, relPath: string) =>
  ['', '.off', MASTER_OFF].map((suf) => path.join(lang, relPath) + suf).find((f) => fs.existsSync(f));

/**
 * Write a mod's packs again without their item pictures, switched on or off as they were. The
 * volumes of a multi-part pack fold into the one file and drop out of `records`.
 * @param records  the mod's files, edited in place
 * @returns how many pictures went
 */
export function dropItemIcons(inst: Pick<Installer, 'langFolder'>, records: LibFile[]): number {
  const lang = inst.langFolder();
  let dropped = 0;
  for (const rec of records) {
    if (rec.root !== 'lang' || !/_dir\.vpk$/i.test(rec.relPath)) continue;
    const abs = onDisk(lang, rec.relPath);
    if (!abs) continue;
    let paths: string[];
    try { paths = listVpkPathsFile(abs); } catch { continue; }
    if (!paths.some((p) => ITEM_ICON_RE.test(p))) continue;
    const entries = readVpkEntries(fs.readFileSync(abs), abs);
    const keep = entries.filter((e) => !ITEM_ICON_RE.test(entryPath(e)));
    dropped += entries.length - keep.length;
    const base = rec.relPath.replace(/_dir\.vpk$/i, '');
    const partRe = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{3}\\.vpk$`, 'i');
    const parts = fs.readdirSync(lang).filter((f) => partRe.test(f));
    fs.writeFileSync(abs, buildVpk(keep));
    for (const f of parts) fs.rmSync(path.join(lang, f), { force: true });
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.root === 'lang' && /_\d{3}\.vpk$/i.test(r.relPath) && !onDisk(lang, r.relPath)) records.splice(i, 1);
  }
  return dropped;
}

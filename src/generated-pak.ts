/**
 * A pak the app built itself (the arcana window, src/arcana-service.ts; the map looks,
 * src/map-looks-service.ts), written into the mods folder like an installed one: a numbered pak
 * in the early part of the load order, and on a rebuild the new one in the slot the old one had.
 */
import path from 'node:path';
import type { Installer } from './installer.ts';
import type { LibFile, LibRecord } from './types.ts';

/** What writing and swapping a generated pak needs of the installer. */
export type PakInstaller = Pick<Installer, 'langFolder' | 'ensureLangFolder' | 'usedPakNames' | 'allocatePak' | 'writeInto' | 'remove' | 'slotBase' | 'moveToSlot' | 'setEnabled'>;

/** The built pak written into a slot in the early part of the load order; the files it took. */
export function writePak(installer: PakInstaller, vpk: Buffer): LibFile[] {
  installer.ensureLangFolder();
  const pakName = installer.allocatePak(installer.usedPakNames(), true);
  installer.writeInto(vpk, path.join(installer.langFolder(), pakName));
  return [{ root: 'lang', relPath: pakName }];
}

/**
 * `vpk` in place of the record's pak: written beside it, then moved into the slot the old one had,
 * and switched off when `off`. The caller builds first, so a build that fails leaves the old one.
 */
export function swapPak(installer: PakInstaller, rec: LibRecord, vpk: Buffer, off: boolean): LibFile[] {
  const oldBase = installer.slotBase(rec);
  let files = writePak(installer, vpk);
  installer.remove(rec.files, { recId: rec.id });
  const newBase = installer.slotBase({ files });
  if (oldBase && newBase && newBase !== oldBase) files = installer.moveToSlot({ files }, oldBase, newBase);
  if (off) installer.setEnabled(files, false, rec.id);
  return files;
}

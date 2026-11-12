/**
 * A pak the app built itself (the arcana window, src/arcana-service.ts; the map looks,
 * src/map-looks-service.ts), written into the mods folder like an installed one: a numbered pak
 * in the early part of the load order, and on a rebuild the new one in the slot the old one had.
 */
import path from 'node:path';
import { sharedVpkIndex } from './vpk.ts';
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

type InForce = Parameters<typeof fileInForce>[0];

/**
 * A compiled style in force, read back as CSS. A mod's copy the tool cannot read is passed over for
 * the next one, down to the game's own, so one odd mod does not stop the build. The game's copy
 * failing is a real failure and is thrown. Null when nobody has the file.
 */
export async function cssInForce(where: Omit<InForce, 'usable' | 'passedOver'>, decompile: (style: Buffer) => Promise<string>, log: (msg: string) => void = () => {}): Promise<{ css: string; from: LibRecord | null } | null> {
  const refused: Buffer[] = [];
  for (;;) {
    const got = fileInForce({ ...where, usable: (data) => !refused.some((r) => r.equals(data)) });
    if (!got) return null;
    try {
      return { css: await decompile(got.data), from: got.from };
    } catch (err) {
      if (!got.from) throw err;
      log(`${got.from.name} carries ${where.file} in a form the tool cannot read, using the next copy`);
      refused.push(got.data);
    }
  }
}

const pakNumber = (rel: string) => Number(/pak(\d+)_/i.exec(rel)?.[1] ?? Infinity);

/**
 * The copy of a game file that is in force before a generated pak of ours: the first switched-on
 * mod's, in load order (the first copy wins, as in the game), else the game's own in pak01. Null
 * when neither has it. `own` is the generated record itself, which never counts. A caller that
 * cannot work on every copy says which it can with `usable`; a mod's copy it refuses is passed over
 * and named to `passedOver`.
 */
export function fileInForce({ game, langFolder, records, own, file, usable = () => true, passedOver = () => {} }: {
  game: string; langFolder: string; records: LibRecord[]; own?: string | null; file: string;
  usable?: (data: Buffer) => boolean; passedOver?: (rec: LibRecord) => void;
}): { data: Buffer; from: LibRecord | null } | null {
  const paks = records
    .filter((r) => r.id !== own && r.enabled !== false)
    .flatMap((r) => (r.files || []).filter((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath)).map((f) => ({ r, rel: f.relPath })))
    .sort((a, b) => pakNumber(a.rel) - pakNumber(b.rel));
  for (const { r, rel } of paks) {
    try {
      const data = sharedVpkIndex(path.join(langFolder, rel)).read(file);
      if (data && usable(data)) return { data, from: r };
      if (data) passedOver(r);
    } catch { /* a pak that cannot be read is not the one in force either */ }
  }
  const data = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk')).read(file);
  return data ? { data, from: null } : null;
}

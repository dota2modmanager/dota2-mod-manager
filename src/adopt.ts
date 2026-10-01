/* What a VPK has to go through before it counts as a mod.
 *
 * A file that just landed in the game folder is not yet a mod: it has no name anybody would
 * recognise, it may carry the whole game's item table, and it may hold four heroes in one
 * archive. Everything here is the difference between a row saying "pak42" and a row saying
 * what the thing actually is.
 *
 * Every route into the library comes through this: the import button, drag and drop, and the
 * mods that arrive inside a shared preset. That last one used to land as a bare record
 * instead, which is why a received build showed up unnamed, unrecognised and still needing
 * "split" by hand, while the same file dragged in by the user came out clean. One door, so
 * that cannot happen again.
 *
 * Lifted out of main.js unchanged, with the services arriving as arguments the way
 * src/cursors.ts and src/presets-service.ts take them. It moved for the same reason the
 * cursors did: main.js cannot be required by a test, so none of this could be tested where it
 * was, and it decides what a user sees in their library.
 */
import { t } from './i18n.ts';
import type { Library } from './library.ts';
import type { LibFile, LibRecord } from './types.ts';

/** What of the installer this asks: a name from the file, what the file is, and the master switch. */
export interface AdoptInstaller {
  displayNameForFile(relPath: string): string | null;
  analyzeRecord(rec: LibRecord): { subjects?: number } | null;
  masterIsOff(): boolean;
  setMasterEnabled(on: boolean): unknown;
}

/** What of the schema service this asks: the item blocks lifted out, and a pack split by hero. */
export interface AdoptSchema {
  harvest(rec: LibRecord): { deltas?: number } | null | undefined;
  split(rec: LibRecord): LibRecord[] | null;
  refresh(): unknown;
}

/** One file or set of files the importer put in the game folder, or why it could not. */
export type ImportResult =
  | { source?: string; files: LibFile[]; name: string; merged?: number; error?: undefined }
  | { source: string; error: string; files?: undefined; name?: undefined; merged?: undefined };

/** What a mod is called and filed as, when the caller knows (a catalog mod, a name a sender meant). */
type Identity = { name: string; categoryId: string; styleLabel: string | null; preview: string | null };

/**
 * @param ctx.installer      reads the file to name and analyse it, and the master switch
 * @param ctx.library        the manifest the record is written into
 * @param ctx.schemaService  lifts the item blocks out, and splits a multi-hero pack
 */
export function createAdopt({ installer, library, schemaService }: {
  installer: AdoptInstaller; library: Pick<Library, 'add' | 'find'>; schemaService: AdoptSchema;
}) {
  /**
   * Everything a VPK that just landed in the game folder needs before it counts as a mod:
   * a name that says what is in it, the item blocks lifted out of it, a split when it turns
   * out to be several heroes in one file, and a match against the catalog fingerprints.
   *
   */
  function adoptImportedFiles({ files, name, fileRef, identity }: {
    files: LibFile[]; name?: string | null; fileRef?: string | null; identity?: Identity | null;
  }): { records: LibRecord[]; schema: boolean; split: boolean } {
    const dirRel = (files.find((f) => /_dir\.vpk$/i.test(f.relPath)) || files[0])?.relPath;
    // a name from the file's own content beats "pak42" and beats a sender's slot name; a
    // real identity (a catalog mod, or a name the sender meant) is kept as it is
    const contentName = (dirRel && installer.displayNameForFile(dirRel)) || null;
    const useContentName = !name || /^!?pak\d+(_dir)?$/i.test(name);
    const base: Identity = identity || {
      name: (useContentName && contentName) || name || contentName || t('Мод'),
      categoryId: 'imported',
      styleLabel: null,
      preview: null,
    };
    const rec = library.add({ ...base, fileRef: fileRef || null, files });

    // skinchanger-style packs carry the whole item table and the localization files:
    // keep the item blocks they changed, drop the tables (see installer.harvestSchema)
    const harvest = schemaService.harvest(rec);
    let schema = !!(harvest && harvest.deltas);

    // …and they can hold several heroes at once. One mod per hero, each with its own files
    // and its own item blocks, so they can be turned on and off separately.
    let parts: LibRecord[] | null = null;
    try {
      const fresh = library.find(rec.id) || rec;
      const subjects = (installer.analyzeRecord(fresh) || {}).subjects || 0;
      // a curated collection of a dozen heroes would eat a dozen pak slots, so only the
      // small exports split by themselves - bigger ones keep the manual "Split" button
      if (subjects >= 2 && subjects <= 4) parts = schemaService.split(fresh);
    } catch { /* a pack that will not split stays one mod */ }
    if (parts && parts.length) {
      for (const p of parts) if (Array.isArray(p.schema) && p.schema.length) schema = true;
      return { records: parts, schema, split: true };
    }
    return { records: [library.find(rec.id) || rec], schema, split: false };
  }

  /* Reading what arrived is the slow half, not copying it: every mod gets its item blocks
   * lifted, its content analysed, and a multi-hero pack rebuilt into one VPK per hero. Seventy
   * of those in a row is minutes of work, so the loop reports where it is and hands the event
   * loop back between mods - otherwise the window stops pumping messages and Windows calls the
   * app dead while it is busy. */
  async function registerImportResults(results: ImportResult[], onStep?: (done: number, total: number) => void) {
    const imported: { name: string; relPath: string; merged: number; fromSplit?: string }[] = [];
    let needSchema = false;
    let read = 0;
    const toRead = results.filter((r) => !r.error).length;
    for (const r of results) {
      if (r.error !== undefined) continue;
      const { records, schema, split } = adoptImportedFiles({ files: r.files, name: r.name, fileRef: r.source });
      if (schema) needSchema = true;
      for (const rec of records) {
        imported.push({
          name: rec.name,
          relPath: rec.files[0].relPath,
          merged: split ? 0 : r.merged || 0,
          ...(split ? { fromSplit: r.name } : {}),
        });
      }
      read++;
      if (onStep) onStep(read, toRead);
      await new Promise<void>((r) => setImmediate(r));
    }
    if (imported.length && installer.masterIsOff()) { try { installer.setMasterEnabled(false); } catch { /* noop */ } }
    if (needSchema) schemaService.refresh();
    return { imported, errors: results.filter((r) => r.error), schema: needSchema };
  }

  return { adoptImportedFiles, registerImportResults };
}


// A mod's own item tables (src/schema-service.ts): the blocks it changed, lifted out on install and
// kept on its record; the whole-game tables it shipped, dropped; a pack of several heroes, split
// into one mod per hero with the blocks about its own files; and the one-time sweep of mods
// installed before any of this existed.
import * as schema from './schema.ts';
import type { Library } from './library.ts';
import type { LibFile, LibRecord } from './types.ts';

/** What of the installer the schema needs: what a record is, its item blocks, splitting it, its size. */
export interface SchemaInstaller {
  analyzeRecord(rec: LibRecord): { fp?: string | null } | null;
  harvestSchema(files: LibFile[], vanillaText: string): { deltas: schema.SchemaDelta[]; stripped: string[] };
  splitVpkFile(relPath: string): { name: string; files: LibFile[]; paths?: string[] }[];
  remove(files: LibFile[]): unknown;
  installedSize(rec: LibRecord): number;
}

/** Lifting, splitting and sweeping, over the library and the installer the service holds. */
export function createHarvest({ library, installer, gamePath, vanilla }: {
  library: Library; installer: SchemaInstaller;
  gamePath: () => string | null; vanilla: () => string;
}) {
  // Lift the item blocks a freshly installed mod changed, drop the whole-game tables it
  // shipped, and remember the blocks on its record.
  function harvest(rec: LibRecord | null | undefined): { deltas: number; stripped: number } | null {
    const game = gamePath();
    if (!game || !rec || !Array.isArray(rec.files)) return null;
    try {
      // Repacking changes the file, and with it the fingerprint the catalog is matched by.
      // Keep the original so a recognised mod does not turn into an unknown one.
      let fpBefore: string | null = null;
      try { fpBefore = (installer.analyzeRecord(rec) || {}).fp || null; } catch { /* not a vpk record */ }
      const { deltas, stripped } = installer.harvestSchema(rec.files, vanilla());
      if (!deltas.length && !stripped.length) return null;
      const fields: Partial<LibRecord> = { files: rec.files };
      if (deltas.length) fields.schema = deltas;
      if (stripped.length && fpBefore) fields.fpOriginal = fpBefore;
      library.update(rec.id, fields);
      return { deltas: deltas.length, stripped: stripped.length };
    } catch { return null; }
  }

  /**
   * A Skinchanger export can hold several heroes at once - its packer bundles whatever was
   * in the cart, so a "Grimstroke" pack may also carry Morphling's files and the item block
   * that goes with them. Split such a record into one mod per hero and hand each part the
   * blocks that talk about its own files.
   * @returns the new records, or null when there was nothing to split
   */
  function split(rec: LibRecord): LibRecord[] | null {
    const dir = (rec.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
    if (!dir) return null;
    let parts;
    try { parts = installer.splitVpkFile(dir.relPath); } catch { return null; }
    if (!parts.length) return null;

    const blocks = Array.isArray(rec.schema) ? rec.schema : [];
    const added: LibRecord[] = [];
    for (const part of parts) {
      const mine = blocks.filter((b) => schema.blockUsesAssets(b.block, part.paths || []));
      const created = library.add({
        name: part.name,
        categoryId: 'imported',
        styleLabel: null,
        fileRef: rec.fileRef || rec.name,
        preview: null,
        files: part.files,
      });
      const fields: Partial<LibRecord> = { schemaChecked: true };
      if (mine.length) fields.schema = mine;
      if (rec.fpOriginal) fields.fpOriginal = rec.fpOriginal;
      library.update(created.id, fields);
      added.push({ ...created, ...fields });
    }
    installer.remove(rec.files);
    library.removeRecord(rec.id);
    return added;
  }

  /**
   * Mods installed before this existed still carry the whole-game tables inside their VPK:
   * a stale item schema (dead weight) and a stale localization copy (which outranks the
   * game's own and rolls UI text back to whenever the mod was built). Sweep them once.
   */
  function migrate(): { scanned: number; changed: number; deltas: number; freedMB: number } {
    const game = gamePath();
    const out = { scanned: 0, changed: 0, deltas: 0, freedMB: 0 };
    if (!game) return out;
    for (const rec of library.list()) {
      if (rec.kind === 'pack' || Array.isArray(rec.schema) || rec.schemaChecked) continue;
      if (!Array.isArray(rec.files) || !rec.files.some((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath))) continue;
      out.scanned++;
      let before = 0;
      try { before = installer.installedSize(rec); } catch { /* size is only for the log line */ }
      const res = harvest(rec);
      // remember that this record was looked at, so a clean mod is not re-scanned every start
      if (!res) { library.update(rec.id, { schemaChecked: true }); continue; }
      out.changed++;
      out.deltas += res.deltas;
      try { out.freedMB += Math.max(0, before - installer.installedSize(rec)) / 1048576; } catch { /* noop */ }
      library.update(rec.id, { schemaChecked: true });
    }
    out.freedMB = Math.round(out.freedMB);
    return out;
  }

  return { harvest, split, migrate };
}

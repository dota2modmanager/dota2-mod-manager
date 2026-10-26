/* The pumpkin's mod belongs to whoever opened the pumpkin (src/pumpkin.ts).
 *
 * It is recognised by what is inside its pak, not by its name or its file: its own folders, which
 * no other mod has. An install that never spent a key of its own and has it anyway was handed a
 * copy, so the mod is switched off, marked, and stays off (src/ipc-library.ts refuses to switch
 * it on); My mods says why on its row. Spending a key later takes the mark off.
 *
 * Every mod is looked into once (`scream` on its record), from mods:list (src/mods-listing.ts),
 * which follows every change, so a copy dropped on the window is caught on the next listing.
 */
import { listVpkPathsFile } from './vpk-read.ts';
import { FileTx } from './file-tx.ts';
import type { LibFile, LibRecord } from './types.ts';

/** Folders only the pumpkin's mod has. */
export const SCREAM_MARKS = ['materials/scream_fx/', 'materials/models/heroes/necrolyte/scream/'];

/** Whether a pak's paths are the pumpkin's mod. */
export function isScream(paths: string[]): boolean {
  return paths.some((p) => { const low = p.toLowerCase().replace(/\\/g, '/'); return SCREAM_MARKS.some((m) => low.startsWith(m)); });
}

interface Deps {
  library: { list(): LibRecord[]; update(id: string, fields: Partial<LibRecord>): unknown };
  settings: { get(key: string): unknown };
  /** the paths in a record's pak: [] when it has none, null when it cannot be read just now */
  pathsOf(rec: LibRecord): string[] | null;
  /** switch a record off, files and record together */
  switchOff(rec: LibRecord): void;
  log?: (msg: string) => void;
}

/** Look into the mods not looked into yet, and switch off a copy this install did not earn. The names caught. */
export function createScreamGuard({ library, settings, pathsOf, switchOff, log = () => {} }: Deps) {
  const earned = () => { const key = settings.get('bloodKey'); return typeof key === 'string' && key.length > 0; };
  return function guard(): string[] {
    const caught: string[] = [];
    const ok = earned();
    for (const rec of library.list()) {
      if (rec.kind === 'pack') continue;
      if (typeof rec.scream !== 'boolean') {
        const paths = pathsOf(rec);
        if (!paths) continue;
        library.update(rec.id, { scream: isScream(paths) });
        rec.scream = isScream(paths);
      }
      if (!rec.scream) continue;
      if (ok) {
        if (rec.cheat) { library.update(rec.id, { cheat: false }); rec.cheat = false; }
        continue;
      }
      if (!rec.cheat) { library.update(rec.id, { cheat: true }); rec.cheat = true; }
      if (rec.enabled !== false) {
        try { switchOff(rec); caught.push(rec.name); log(`scream: a copy nobody earned here, switched off: ${rec.name}`); } catch (err) { log(`scream: not switched off: ${String(err)}`); }
      }
    }
    return caught;
  };
}

/** What of the app the guard reaches for in the main process. */
interface AppDeps {
  installer: { langFileOnDisk(relPath: string): string; setEnabled(files: LibFile[], enabled: boolean, recId?: string): unknown; log?: (msg: string) => void };
  library: Deps['library'] & { setEnabled(id: string, enabled: boolean): unknown };
  settings: Deps['settings'];
  /** after a record went off: the item table is rebuilt if the mod changed it */
  afterOff?: (rec: LibRecord) => void;
  log?: (msg: string) => void;
}

/** The guard over the installer and the library (src/ipc-mods.ts): paks read from the game folder. */
export function screamGuardFor({ installer, library, settings, afterOff = () => {}, log }: AppDeps) {
  return createScreamGuard({
    library, settings, log,
    pathsOf: (rec) => {
      const dir = (rec.files || []).find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
      if (!dir) return [];
      try { return listVpkPathsFile(installer.langFileOnDisk(dir.relPath)); } catch { return null; }
    },
    switchOff: (rec) => {
      FileTx.run(() => { installer.setEnabled(rec.files, false, rec.id); library.setEnabled(rec.id, false); }, installer.log);
      afterOff(rec);
    },
  });
}

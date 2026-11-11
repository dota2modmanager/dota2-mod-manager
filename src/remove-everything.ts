/* Taking out everything the app put into the game, in one go.
 *
 * Two places ask for it: the uninstaller (src/uninstall-window.ts), and the button in Settings
 * for a person who wants their game back the way Steam gave it without removing the app. The
 * Discord asks for the second one every week, usually after a Dota update, and until now the
 * only answer was "uninstall and install again".
 *
 * Everything goes through the same code the app uses day to day rather than deleting paths by
 * hand, so a mod comes out the way removing it from My mods would, and the patch comes out the
 * way the safe-mode switch would. */
import { removeNotice } from './notice-text.ts';
import type { LibFile, LibRecord } from './types.ts';

/** What of the installer the removal asks. */
export interface RemovingInstaller {
  langFolder(): string;
  removePackFully(rec: LibRecord): unknown;
  remove(files: LibFile[], opts: { recId: string; deployed: boolean }): unknown;
}

/** The app's services the removal borrows, so it removes the way the app does. */
export interface RemoveEverythingDeps {
  settings: { get(key: string): unknown };
  library: { list(): LibRecord[]; removeRecord(id: string): unknown };
  installer: RemovingInstaller;
  schemaService: { setEnabled(on: boolean): unknown };
  /** how one mod comes out; the app wraps it in a file transaction (src/ipc-library.ts) */
  removeOne?: (rec: LibRecord) => void;
}

/**
 * Take out what was asked for, carrying on past a mod that will not come out.
 * @param revert put gameinfo and the signatures back, when safe mode was turned off
 * @param mods   take every mod out of the game folder and off the list
 * @param notice take out the anti-cheat notice pak too (the uninstaller)
 * @returns one line per thing that could not be removed; empty when all of it went
 */
export function removeEverything({ settings, library, installer, schemaService, removeOne }: RemoveEverythingDeps,
  { revert, mods, notice = true }: { revert: boolean; mods: boolean; notice?: boolean }): { errors: string[]; removed: number } {
  const takeOut = removeOne || ((rec: LibRecord) => {
    if (rec.kind === 'pack') installer.removePackFully(rec);
    else installer.remove(rec.files, { recId: rec.id, deployed: rec.enabled !== false });
    library.removeRecord(rec.id);
  });
  const errors: string[] = [];
  let removed = 0;
  // Order matters. The patch goes first because reverting reads the backups in the app's own
  // folder, and mods go before that folder is wiped (by the uninstaller) for the same reason: the
  // manifest is the only record of which files in the game folder were ours.
  if (revert && settings.get('schemaPatch')) {
    try { schemaService.setEnabled(false); } catch (err) { errors.push(`patch: ${(err as Error)?.message || err}`); }
  }
  if (mods) {
    for (const rec of [...library.list()]) {
      try {
        takeOut(rec);
        removed++;
      } catch (err) {
        errors.push(`${rec.name}: ${(err as Error)?.message || err}`);
      }
    }
  }
  /* The notice text names this app's switch, so it goes with the app. While the app stays it is
   * left: the app writes it back on the next start anyway (src/notice-text.ts), and it only
   * replaces the anti-cheat window's words. */
  if (notice && settings.get('dotaGamePath')) {
    try { removeNotice(installer.langFolder()); } catch (err) { errors.push(`notice: ${(err as Error)?.message || err}`); }
  }
  return { errors, removed };
}

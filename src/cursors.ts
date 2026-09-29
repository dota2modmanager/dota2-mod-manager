/* Which cursor set is live, and which look a slot is wearing.
 *
 * A cursor set is not a pak. It is loose files written straight over Valve's own in
 * game\dota\resource\cursor, and every set writes the same names, so it cannot be switched off
 * by renaming and two sets cannot be on at once. Everything here exists because of that: one
 * set gives way when another comes on, the master switch has to take them off by hand because
 * renaming paks leaves them untouched, and a folder that drifted from the manifest has to be
 * put back at startup.
 *
 * Lifted out of main.js unchanged, with the services arriving as arguments the way
 * src/presets-service.js takes them. It moved for a reason beyond size: main.js cannot be
 * required by a test (it pulls in Electron), so the startup repair below - which decides
 * whether a user's cursor comes back after a game update or a Steam verify - could not be
 * tested where it was. test/cursors.test.ts is what the move is for.
 */
import fs from 'node:fs';
import type { Settings } from './settings.ts';
import type { LibFile, LibRecord } from './types.ts';

/** What of the installer this needs: the cursor store, deploy and undeploy. */
export interface CursorInstaller {
  setEnabled(files: LibFile[], enabled: boolean, recId?: string | null): unknown;
  deployCursor(recId: string, files: LibFile[]): unknown;
  undeployCursor(recId: string, files: LibFile[]): unknown;
  masterIsOff(): boolean;
  cursorStoreDir(recId: string): string;
  ensureCursorStore(recId: string, files: LibFile[]): boolean;
}

/** What of the library this needs: the records, and switching one. */
export interface CursorLibrary {
  list(): LibRecord[];
  setEnabled(id: string, enabled: boolean): unknown;
}

/** A record that owns cursor files, whatever else it holds. */
export function isCursorRecord(rec: Pick<LibRecord, 'files'> | null | undefined): boolean {
  return !!rec && (rec.files || []).some((f) => f.root === 'cursor');
}

/**
 * @param ctx.installer  the installer engine: the cursor store, deploy and undeploy
 * @param ctx.library    the manifest of installed records
 * @param ctx.settings   read for the game path, which the repair needs
 */
export function createCursors({ installer, library, settings }: {
  installer: CursorInstaller; library: CursorLibrary; settings: Pick<Settings, 'get'>;
}) {
  // switch off every cursor set except one, and report which ones gave way
  function disableOtherCursors(exceptId: string | null | undefined): string[] {
    const off: string[] = [];
    for (const rec of library.list()) {
      if (rec.id === exceptId || rec.enabled === false || !isCursorRecord(rec)) continue;
      try {
        installer.setEnabled(rec.files, false, rec.id);
        library.setEnabled(rec.id, false);
        off.push(rec.name);
      } catch { /* noop */ }
    }
    return off;
  }

  // a slot (weather, courier, ...) only ever has one active look — same rule as cursors,
  // just without files to rename: the sibling only needs its enabled flag flipped
  function disableOtherCosmetics(rec: Pick<LibRecord, 'id' | 'slot'>): string[] {
    const off: string[] = [];
    for (const other of library.list()) {
      if (other.id === rec.id || other.enabled === false) continue;
      if (other.categoryId !== 'cosmetic' || other.slot !== rec.slot) continue;
      library.setEnabled(other.id, false);
      off.push(other.name);
    }
    return off;
  }

  // the master switch renames paks in the language folder, which leaves cursors untouched —
  // take them off (and put them back) alongside it, so "mods off" really means vanilla
  function applyMasterToCursors(enabled: boolean): void {
    for (const rec of library.list()) {
      if (rec.enabled === false || !isCursorRecord(rec)) continue;
      try {
        if (enabled) installer.deployCursor(rec.id, rec.files);
        else installer.undeployCursor(rec.id, rec.files);
      } catch { /* noop */ }
    }
  }

  /* Startup repair: the cursor folder can drift from the manifest (a game update, a Steam
   * verify, another tool), and records made before cursors could be switched off have no
   * stored copy yet. Also settles the legacy case of several sets marked on at once — only
   * the newest was ever really on disk. */
  function reconcileCursors(): void {
    if (!settings.get('dotaGamePath')) return;
    const cursors = library.list().filter(isCursorRecord)
      .sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0));
    if (!cursors.length) return;
    let masterOff = false;
    try { masterOff = installer.masterIsOff(); } catch { /* no language folder yet */ }
    let liveClaimed = false;
    for (const rec of cursors) {
      try {
        if (!fs.existsSync(installer.cursorStoreDir(rec.id))) {
          const adopted = rec.enabled !== false && !liveClaimed && installer.ensureCursorStore(rec.id, rec.files);
          if (adopted) liveClaimed = true;
          else {
            // nothing of this set is kept anywhere — it can only come back by reinstalling
            if (rec.enabled !== false) library.setEnabled(rec.id, false);
            continue;
          }
        }
        if (rec.enabled === false || masterOff) installer.undeployCursor(rec.id, rec.files);
        else installer.deployCursor(rec.id, rec.files);
      } catch { /* best-effort */ }
    }
  }

  return { isCursorRecord, disableOtherCursors, disableOtherCosmetics, applyMasterToCursors, reconcileCursors };
}


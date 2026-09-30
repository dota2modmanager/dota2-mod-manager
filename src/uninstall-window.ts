/* Being uninstalled.
 *
 * Removing the app used to leave everything it had done: the mods still in the game's language
 * folder with nothing left to manage them, the app's folder with its settings, caches and the
 * fifty-megabyte toolchain, and - if safe mode had been turned off -
 * gameinfo_branchspecific.gi and dota.signatures still carrying our edit, with the one program
 * that knows how to put them back now gone.
 *
 * The uninstaller therefore runs the app one last time (see build/installer.nsh) and this is
 * what it runs: a window that asks what to take with it, and the work itself. Everything here
 * goes through the same code the app uses day to day rather than deleting paths by hand, so a
 * mod comes out the way removing it from the Library would, and the patch comes out the way
 * the safe-mode switch would.
 *
 * Exit codes are the answer to the uninstaller: 3 means the person changed their mind and
 * nothing should be removed at all, anything else means carry on. 4 additionally means the
 * app's own folder goes with the program.
 *
 * It lives here rather than in src/main.ts because it is a whole second application - its own
 * window, its own preload, its own five IPC channels, its own exit protocol - that shares
 * nothing with the app except the services it borrows to do the removing.
 */
import fs from 'node:fs';
import path from 'node:path';

import { removeNotice } from './notice-text.ts';
import { electron } from './electron.ts';
import type { Settings } from './settings.ts';
import type { Library } from './library.ts';
import type { LibFile, LibRecord } from './types.ts';


/** What of the installer the removal asks: sizes, the language folder, and taking mods out. */
export interface UninstallInstaller {
  installedSize(rec: LibRecord): number;
  langFolder(): string;
  removePackFully(rec: LibRecord): unknown;
  remove(files: LibFile[], opts: { recId: string; deployed: boolean }): unknown;
}

/** The exit code that tells the uninstaller to stop and remove nothing. */
export const UNINSTALL_CANCELLED = 3;
/** The exit code that tells it to take the app's own folder too. */
export const UNINSTALL_WIPE_DATA = 4;

/** Bytes under a folder, however deep. */
export function folderSize(dir: string): number {
  let bytes = 0;
  const walk = (at: string) => {
    let names: fs.Dirent[] = [];
    try { names = fs.readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const full = path.join(at, e.name);
      if (e.isDirectory()) walk(full);
      else { try { bytes += fs.statSync(full).size; } catch { /* vanished mid-walk */ } }
    }
  };
  walk(dir);
  return bytes;
}

/**
 * The uninstall flow, given the app's own services.
 *
 * @param deps.installer     removes files the way the Library does
 * @param deps.schemaService reverts the search-path patch the way the switch does
 * @param deps.diag          the app's log line
 * @param deps.appRoot       where preload-uninstall.js and renderer/ live
 */
export function uninstallFlow({ settings, library, installer, schemaService, diag, appRoot }: {
  settings: Pick<Settings, 'get'>; library: Pick<Library, 'list' | 'removeRecord'>; installer: UninstallInstaller;
  schemaService: { setEnabled(on: boolean): unknown }; diag: (msg: string) => void; appRoot: string;
}): { open: () => Electron.BrowserWindow } {
  const { app, BrowserWindow, ipcMain } = electron();
  let answered = false;

  /** What there is to remove, so the window can say it rather than ask in the abstract. */
  const plan = () => {
    const mods = library.list().filter((r) => r.categoryId !== 'cosmetic');
    // installedSize takes one record: a disabled mod sits under .off and a pack under its own
    // name, and only the installer knows where each of its files ended up
    let modBytes = 0;
    for (const rec of mods) {
      try { modBytes += installer.installedSize(rec); } catch { /* removed by hand already */ }
    }
    return {
      mods: mods.length,
      modBytes,
      patched: !!settings.get('schemaPatch'),
      gamePath: settings.get('dotaGamePath') || null,
      dataBytes: folderSize(app.getPath('userData')),
      lang: settings.get('uiLang') === 'ru' ? 'ru' : 'en',
    };
  };

  /* The app's own folder is not deleted here, though this is where it is decided.
   *
   * It is the folder this process is running out of: its log is open, so are Chromium's
   * caches, and deleting around them leaves a scatter of locked files and an error on screen
   * at the worst possible moment. The uninstaller can do it cleanly a second later, once this
   * has exited, and it already knows how - so the answer travels back as the exit code and
   * build/installer.nsh does the removing. */
  const run = async ({ revert, mods }: { revert: boolean; mods: boolean }): Promise<string[]> => {
    const errors: string[] = [];
    // Order matters. The patch goes first because reverting reads the backups in the app's own
    // folder, and mods go before that folder is wiped for the same reason: the manifest is the
    // only record of which files in the game folder were ours.
    if (revert && settings.get('schemaPatch')) {
      try { schemaService.setEnabled(false); } catch (err) { errors.push(`patch: ${(err as Error)?.message || err}`); }
    }
    if (mods) {
      for (const rec of [...library.list()]) {
        try {
          if (rec.kind === 'pack') installer.removePackFully(rec);
          else installer.remove(rec.files, { recId: rec.id, deployed: rec.enabled !== false });
          library.removeRecord(rec.id);
        } catch (err) {
          errors.push(`${rec.name}: ${(err as Error)?.message || err}`);
        }
      }
    }
    // The notice text goes whatever the answer: it names this app's switch, and the app is going.
    if (settings.get('dotaGamePath')) {
      try { removeNotice(installer.langFolder()); } catch (err) { errors.push(`notice: ${(err as Error)?.message || err}`); }
    }
    diag(`uninstall: revert=${revert} mods=${mods} errors=${errors.length}`);
    return errors;
  };

  const createWindow = (): Electron.BrowserWindow => {
    const w = new BrowserWindow({
      width: 560,
      height: 520,
      resizable: false,
      backgroundColor: '#050506',
      autoHideMenuBar: true,
      frame: false,
      show: !process.env.MM_QUIET, // dev: see the note on the main window
      webPreferences: {
        preload: path.join(appRoot, 'preload-uninstall.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    w.loadFile(path.join(appRoot, 'renderer', 'uninstall.html'));
    // dev: this window only ever opens from the uninstaller, so without a way to look at it
    // it cannot be checked at all. Same MM_SHOT/MM_EVAL contract as the main window.
    if (process.env.MM_SHOT) {
      const shot = process.env.MM_SHOT;
      w.webContents.once('did-finish-load', () => setTimeout(async () => {
        try {
          if (process.env.MM_EVAL) {
            const out = await w.webContents.executeJavaScript(`(async () => { ${process.env.MM_EVAL} })()`);
            fs.writeFileSync(`${shot}.eval.json`, JSON.stringify(out, null, 1));
          }
          fs.writeFileSync(shot, (await w.webContents.capturePage()).toPNG());
        } catch (e) {
          fs.writeFileSync(shot + '.err.txt', String(e));
        }
      }, 2500));
    }
    // closing the window is not an answer, so it counts as the safe one
    w.on('closed', () => { if (!answered) app.exit(UNINSTALL_CANCELLED); });
    return w;
  };

  const registerIpc = () => {
    ipcMain.handle('uninstall:plan', () => plan());
    ipcMain.handle('uninstall:run', async (_e, choices: { revert?: boolean; mods?: boolean } | null) => {
      answered = true;
      const errors = await run({ revert: !!choices?.revert, mods: !!choices?.mods });
      return { ok: true, errors };
    });
    // The exit code is the whole answer to the uninstaller: whether to stop, and whether the
    // app's folder goes with the program.
    ipcMain.handle('uninstall:done', (_e, wipeData: boolean) => {
      answered = true;
      app.exit(wipeData ? UNINSTALL_WIPE_DATA : 0);
    });
    ipcMain.handle('uninstall:cancel', () => { answered = true; app.exit(UNINSTALL_CANCELLED); });
  };

  return {
    /** Put the window up and wire its channels. */
    open() {
      const w = createWindow();
      registerIpc();
      return w;
    },
  };
}


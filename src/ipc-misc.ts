/* The small errands: opening a folder in Explorer, opening a link in the browser, and what
 * the download cache weighs.
 *
 * openExternal is the one with teeth. The renderer can ask for any address, so this is the
 * boundary that decides which ones the system is allowed to be handed.
 */
import fs from 'node:fs';
import path from 'node:path';

import { t } from './i18n.ts';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services and callbacks src/main.ts hands it. */
export function registerMiscIpc({
  installer, library,
}: Pick<AppContext, 'installer' | 'library'>): void {
  const { ipcMain, shell } = electron();
  ipcMain.handle('misc:openLangFolder', () => {
    try {
      const lang = installer.langFolder();
      fs.mkdirSync(lang, { recursive: true });
      shell.openPath(lang);
      return { ok: true };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  /** A tool folder this app installed, by the name its record gives it, or null for anything else. */
  const toolFolder = (name: unknown): string | null => {
    const sub = String(name || '');
    const known = library.list().some((rec) => (rec.files || [])
      .some((f) => f.root === 'tools' && f.relPath === sub));
    const dir = path.join(installer.toolsDir, sub);
    return known && path.dirname(dir) === path.resolve(installer.toolsDir) ? dir : null;
  };

  ipcMain.handle('misc:openToolsFolder', (e, sub) => {
    // shell.openPath runs what it is handed: joined unchecked, "../.." here opened any folder on
    // the disk, and a path to an .exe started it. Only a tool folder the library knows.
    const p = sub ? toolFolder(sub) : installer.toolsDir;
    if (!p) return { error: t('Инструмент не найден') };
    shell.openPath(p);
    return { ok: true };
  });

  ipcMain.handle('misc:openExternal', (e, url) => {
    // the address is parsed, not matched: the browser gets http and https and nothing else
    try {
      if (/^https?:$/.test(new URL(String(url)).protocol)) shell.openExternal(String(url));
    } catch { /* not an address */ }
    return { ok: true };
  });

  ipcMain.handle('misc:cacheSize', () => installer.downloadCacheSize());
  ipcMain.handle('misc:clearCache', () => {
    installer.clearDownloadCache();
    return { ok: true };
  });

  ipcMain.handle('misc:runTool', (e, toolDirName) => {
    // find first exe inside the tool folder and launch it
    try {
      // The name has to be one of the tool folders this app installed and nothing else:
      // joined unchecked, "../../.." pointed this at any folder on the disk, and what it
      // does with a folder is run the first .exe in it.
      const dir = toolFolder(toolDirName);
      if (!dir) return { error: t('Инструмент не найден') };
      const findExe = (d: string): string | null => {
        for (const f of fs.readdirSync(d)) {
          const full = path.join(d, f);
          if (fs.statSync(full).isDirectory()) {
            const r = findExe(full);
            if (r) return r;
          } else if (f.toLowerCase().endsWith('.exe')) {
            return full;
          }
        }
        return null;
      };
      const exe = findExe(dir);
      if (!exe) return { error: t('exe не найден в папке инструмента') };
      shell.openPath(exe);
      return { ok: true };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

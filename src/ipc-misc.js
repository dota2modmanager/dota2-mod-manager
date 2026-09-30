/* The small errands: opening a folder in Explorer, opening a link in the browser, and what
 * the download cache weighs.
 *
 * openExternal is the one with teeth. The renderer can ask for any address, so this is the
 * boundary that decides which ones the system is allowed to be handed. Bodies unchanged.
 */
const fs = require('fs');
const path = require('path');
const { ipcMain, shell } = require('electron');

const { t } = require('./i18n.ts');

/** @param {object} ctx  the services and main-process callbacks these channels use */
function registerMiscIpc({
  installer, library,
}) {
  ipcMain.handle('misc:openLangFolder', () => {
    try {
      const lang = installer.langFolder();
      fs.mkdirSync(lang, { recursive: true });
      shell.openPath(lang);
      return { ok: true };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  ipcMain.handle('misc:openToolsFolder', (e, sub) => {
    const p = sub ? path.join(installer.toolsDir, sub) : installer.toolsDir;
    shell.openPath(p);
    return { ok: true };
  });

  ipcMain.handle('misc:openExternal', (e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
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
      const name = String(toolDirName || '');
      const known = library.list().some((rec) => (rec.files || [])
        .some((f) => f.root === 'tools' && f.relPath === name));
      if (!known) return { error: t('Инструмент не найден') };
      const dir = path.join(installer.toolsDir, name);
      if (path.dirname(dir) !== path.resolve(installer.toolsDir)) return { error: t('Инструмент не найден') };
      const findExe = (d) => {
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
      return { error: String(err.message || err) };
    }
  });
}

module.exports = { registerMiscIpc };

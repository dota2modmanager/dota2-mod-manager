/* The window and the build: the title bar's three buttons, the update channels, the release
 * notes and the content zoom.
 *
 * Nothing here touches the game folder or the catalog. Bodies unchanged from main.js.
 */
const path = require('path');
const { app, ipcMain, shell } = require('electron');

const { t } = require('./i18n.ts');

/** @param {object} ctx  the services and main-process callbacks these channels use */
function registerWindowIpc({
  IS_PORTABLE, autoUpdater, clampZoom, diag, portableUpdate, portableUpdater,
  releaseNotes, sendProgress, settings, win,
}) {
  // `win` arrives as a getter, not as the window. These are registered before the window
  // is created, so a value captured here would be undefined forever - which is exactly
  // what win:isMaximized did on the first run after this file was split out.
  ipcMain.handle('win:minimize', () => win().minimize());
  ipcMain.handle('win:maximize', () => {
    if (win().isMaximized()) win().unmaximize();
    else win().maximize();
    return win().isMaximized();
  });
  ipcMain.handle('win:close', () => win().close());
  ipcMain.handle('win:isMaximized', () => win().isMaximized());

  // ----- updates -----
  // Portable copies cannot install over themselves (see src/portable-update.js). This puts the
  // new build next to the current one and hands back where it landed, so the user closes this
  // window and double-clicks that instead of visiting the site.
  ipcMain.handle('update:fetchPortable', async () => {
    if (!IS_PORTABLE) return { error: t('Это не портативная сборка') };
    /* A getter, like `win` above and for the same reason. The version is learned when the update
       check finds one, which is minutes after these handlers are registered, so a value captured
       here is null for the life of the process and this button answered "no update" every time. */
    const version = portableUpdate();
    if (!version) return { error: t('Обновления нет') };
    try {
      const got = await portableUpdater.fetchBeside(version, {
        onProgress: (loaded, total) => sendProgress({ type: 'download', label: `v${version}`, loaded, total }),
        log: diag,
      });
      sendProgress({ type: 'done', label: `v${version}` });
      diag(`portable update fetched: ${got.name}`);
      return { ok: true, name: got.name, path: got.path, already: !!got.already };
    } catch (err) {
      sendProgress({ type: 'error', label: `v${version}`, message: String(err.message || err) });
      return { error: String(err.message || err) };
    }
  });

  ipcMain.handle('update:revealPortable', (e, filePath) => {
    // only ever the file this app just wrote, next to the running exe
    const dir = portableUpdater.portableDir();
    if (!dir || path.dirname(path.resolve(filePath)) !== path.resolve(dir)) return { error: t('Файл не найден') };
    shell.showItemInFolder(filePath);
    return { ok: true };
  });

  ipcMain.handle('update:install', () => {
    if (autoUpdater) autoUpdater.quitAndInstall();
  });
  ipcMain.handle('app:version', () => app.getVersion());

  // What changed in the version now running. The app updates itself in the background, so
  // without this a user is simply handed a different app one day and has to guess what
  // moved — which is exactly what people ask about in Discord.
  ipcMain.handle('app:notes', (e, lang) => {
    const version = app.getVersion();
    const seen = settings.get('lastSeenVersion');
    return { version, notes: releaseNotes(version, lang), unseen: !!seen && seen !== version };
  });

  ipcMain.handle('app:notesSeen', () => {
    settings.set('lastSeenVersion', app.getVersion());
    return { ok: true };
  });

  // ----- UI scale ----- (the renderer applies it; this only remembers it)
  ipcMain.handle('ui:setZoom', (e, factor) => {
    const z = clampZoom(factor);
    settings.set('uiScale', z);
    return { ok: true, uiScale: z };
  });
}

module.exports = { registerWindowIpc };

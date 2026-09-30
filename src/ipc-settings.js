/* Settings, the Discord account, and asking the catalog for a refresh.
 *
 * Both settings handlers answer with the whole view rather than the bare store, because the
 * renderer caches whatever it is handed - see src/settings-view.js for what that cost once.
 * Bodies unchanged from main.js.
 */
const path = require('path');
const { dialog, ipcMain } = require('electron');

const i18n = require('./i18n.ts');
const { t } = i18n;
const { betaState } = require('./beta.ts');

/** @param {object} ctx  the services and main-process callbacks these channels use */
function registerSettingsIpc({
  // The four read late are main-process state that changes while the app runs; setPresenceView
  // writes one back. Passing values here would freeze them at registration time.
  applyPresenceSetting, catalog, discordAuth, findDotaGamePath, library, moveLangFolder,
  presence, refreshPresence, remoteConfig, settings, settingsView, validateGamePath,
  langFolder, patchWatcher, setPresenceView, updater, win,
}) {
  /* The beta channel, from the switch in settings and the list in the signed config.
   *
   * Read rather than remembered: an account taken off the list, or signed out of Discord, is back
   * on the stable channel at the next check without anybody touching their machine. src/beta.ts
   * holds the rule, src/updater.ts does the aiming, and neither is asked whether the user is
   * "allowed" anywhere else - this is who is offered the build, not who can run it. */
  const beta = () => betaState({
    discordId: (settings.get('account') || {}).id || null,
    beta: remoteConfig.beta(),
    wanted: settings.get('betaChannel') === true,
  });

  ipcMain.handle('beta:state', () => beta());

  ipcMain.handle('beta:set', (e, on) => {
    settings.set('betaChannel', on === true);
    const state = beta();
    // look now rather than in four hours: switching this on is a question the user just asked
    updater()?.recheck();
    return state;
  });

  ipcMain.handle('settings:get', () => settingsView({ consumeMigration: true }));

  ipcMain.handle('settings:set', (e, key, value) => {
    // keep main-process strings (dialogs, errors) in sync with the UI language
    if (key === 'uiLang') i18n.setLang(value);
    settings.set(key, value);
    // the status text is localized, so a language change has to redraw it too
    if (key === 'discordPresence' || key === 'uiLang') applyPresenceSetting();
    return settingsView();
  });

  // ----- Discord presence -----
  // the renderer tells us which tab is open; everything else comes from the library
  ipcMain.handle('presence:view', (e, view) => {
    setPresenceView(typeof view === 'string' ? view : 'catalog');
    refreshPresence();
  });

  // ----- account (Discord) -----
  ipcMain.handle('account:signIn', async () => {
    try {
      const account = await discordAuth.signIn();
      settings.set('account', account);
      if (win() && !win().isDestroyed()) { win().show(); win().focus(); }
      return { ok: true, account };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  ipcMain.handle('account:signOut', () => {
    settings.set('account', null);
    // no account, nobody to check against the list: back to the channel everybody else reads
    updater()?.recheck();
    return { ok: true };
  });

  // rescue mods sitting in a folder the game does not mount (our old dota_123, another
  // tool's dota_minify, or whatever the audio language used to be)
  ipcMain.handle('settings:moveLangFiles', (e, fromSuffix) => {
    const game = settings.get('dotaGamePath');
    if (!game) return { error: t('Путь к Dota 2 не задан') };
    const moved = moveLangFolder(game, String(fromSuffix || ''), langFolder());
    return { moved, to: langFolder() };
  });

  ipcMain.handle('settings:detectDota', async () => {
    const found = await findDotaGamePath();
    if (found) {
      settings.set('dotaGamePath', found);
      // the watcher is holding handles on the folder that was current a moment ago
      patchWatcher()?.rearm();
    }
    return found;
  });

  ipcMain.handle('settings:browseDota', async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: t('Выбери папку game внутри dota 2 beta'),
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    let p = res.filePaths[0];
    // allow picking "dota 2 beta" root as well
    if (!validateGamePath(p) && validateGamePath(path.join(p, 'game'))) p = path.join(p, 'game');
    if (!validateGamePath(p)) return { error: t('В этой папке нет файлов Dota 2 — нужна папка game внутри dota 2 beta') };
    settings.set('dotaGamePath', p);
    patchWatcher()?.rearm();
    return { path: p };
  });

  // ----- catalog -----
  ipcMain.handle('catalog:load', async (e, force) => {
    try {
      return await catalog.load({ forceRefresh: !!force });
    } catch (err) {
      /* The kind of failure travels with the words. "fetch failed" is Node's way of saying it
         could not open a socket, and printing that at somebody who turned their wifi off is
         the same as printing nothing. src/net.ts marks a failure to connect; the screen turns
         that into a sentence and keeps the technical half for the diagnostics report. */
      return { error: String(err.message || err), offline: !!err.offline };
    }
  });
}

module.exports = { registerSettingsIpc };

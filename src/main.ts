/*
 * Dota 2 Mod Manager
 * Copyright (C) 2026 TheFleece
 *
 * Free software under the GNU General Public License, version 3 or later. It comes with no
 * warranty whatsoever. LICENSE holds the terms; NOTICE holds the additional terms this
 * repository adds under section 7 of that License, about credit and the program's name.
 */

/* The main process: the order the app starts in, and nothing else.
 *
 * Every subject lives in a module of its own under src/. This file builds the services once the
 * app is ready (src/services.ts), puts the game folder right (src/game-upkeep.ts), hands every IPC module the same
 * AppContext (src/app-context.ts) and opens the window. Because each module takes a Pick of that
 * one type, a name a module needs and this file forgot is a type error rather than an
 * "x is not a function" the first time somebody clicks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { electron } from './electron.ts';
import { createServices } from './services.ts';
import { SCHEME } from './preset-link.ts';
import * as discordAuth from './discord-auth.ts';
import { findDotaGamePath, validateGamePath } from './steam.ts';
import * as portableUpdater from './portable-update.ts';
import { createUpdater, type UpdaterLike } from './updater.ts';
import { channelFor } from './beta.ts';
import { createPatchWatcher } from './patch-watch.ts';
import { moveLangFolder } from './gamelang.ts';
import { uninstallFlow } from './uninstall-window.ts';
import { isUninstallRun } from './uninstall-args.ts';
import { createGate } from './feature-gate.ts';
import { settingsViewFor } from './settings-view.ts';
import { registerIpc } from './ipc.ts';
import { createAppLog } from './app-log.ts';
import { releaseNotes } from './release-notes.ts';
import { firstLink, handleDeepLink, installDesktopEntry } from './deep-links.ts';
import { createMainWindow, clampZoom, workAreaFrom } from './main-window.ts';
import { attachDevHarness } from './dev-harness.ts';
import { createGameUpkeep, dotaIsRunning } from './game-upkeep.ts';
import type { AppContext, AppProgress } from './app-context.ts';
import type { BrowserWindow } from 'electron';

const { app, ipcMain, shell, net } = electron();

/** electron-updater, which a development checkout may not have installed yet. */
type AutoUpdater = UpdaterLike & { quitAndInstall(): void };
let autoUpdater: AutoUpdater | null = null;
try {
  ({ autoUpdater } = createRequire(import.meta.url)('electron-updater') as { autoUpdater: AutoUpdater });
} catch { /* dev environment without the dependency installed yet */ }

/* Portable mode (issue #2).
 *
 * electron-builder's portable target unpacks the app into a temp folder and runs it from there,
 * setting PORTABLE_EXECUTABLE_DIR to the folder the exe was actually launched from. Without using
 * that, "portable" would only mean "no installer": the settings, the mod library and the download
 * cache would still sit in %APPDATA%, and somebody carrying the exe on a stick would find none of
 * it on the next machine. So the data goes next to the exe, which is what the word promises.
 *
 * A folder that cannot be written to falls back to the ordinary location rather than failing.
 * That is what happens when the exe is dropped into Program Files, and a working app with its data
 * in the usual place beats a dead one.
 */
const IS_PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;
if (IS_PORTABLE) {
  try {
    const beside = path.join(process.env.PORTABLE_EXECUTABLE_DIR!, 'Dota 2 Mod Manager Data');
    fs.mkdirSync(beside, { recursive: true });
    fs.accessSync(beside, fs.constants.W_OK);
    app.setPath('userData', beside);
  } catch { /* read-only folder: the default userData still works */ }
}

/* Asked to put up the removal window, unless this is an update wearing the same clothes.
 *
 * The uninstaller runs the app once with --uninstall to ask what should go along with it, and
 * reads the exit code for the answer (build/installer.nsh). An update runs the old uninstaller
 * with --updated and /KEEP_APP_DATA, and the NSIS side already stops there. This is the second
 * lock on the same door: it went wrong once, in front of everybody, and the failure mode is a
 * person being asked whether to delete their mods while they are merely updating. Both locks and
 * the reasoning are in src/uninstall-args.ts, which takes a command line so the cases can be
 * tested without being launched. */
const IS_UNINSTALL = isUninstallRun(process.argv);

// A small rotating log every install keeps, so a support report does not depend on reproducing
// the problem live (src/app-log.ts). MM_DIAG mirrors it for the screenshot harness.
const appLog = createAppLog({ dir: () => app.getPath('userData'), mirror: process.env.MM_DIAG || null });
const diag = (msg: string) => appLog.diag(msg);

process.on('uncaughtException', (err) => diag(`uncaughtException: ${err?.stack || err}`));
process.on('unhandledRejection', (reason) => diag(`unhandledRejection: ${(reason as Error | null)?.stack || reason}`));

let win: BrowserWindow | undefined;
const windowOpen = () => (win && !win.isDestroyed() ? win : null);

// Presets take a link that arrives before the rest of the app is up; until then there is nothing
// to park it in. Assigned once the services exist.
let presets: ReturnType<typeof createServices>['presets'] | null = null;

// A preset link clicked anywhere on the system (src/deep-links.ts): parked in Presets, never
// installed from the link itself.
const takeLink = (url: string | null | undefined) => handleDeepLink(url, {
  importPresetLink: (code) => presets?.importPresetLink(code) ?? null,
  win: windowOpen,
});

// One running copy only: two instances writing manifest.json would race each other, and a link
// clicked while the app is open must reach the window that already exists.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const w = windowOpen();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
    takeLink(firstLink(argv));
  });
  app.on('open-url', (e, url) => { e.preventDefault(); takeLink(url); }); // macOS
}

app.whenReady().then(start).catch((e) => diag(`whenReady FAIL: ${(e as Error)?.stack || e}`));
app.on('window-all-closed', () => app.quit());

/** Build the services, put the game folder right, register the channels and open the window. */
async function start(): Promise<void> {
  diag('whenReady');
  const userData = app.getPath('userData');
  const appRoot = app.getAppPath();
  const sendProgress = (evt: AppProgress) => windowOpen()?.webContents.send('progress', evt);

  const services = createServices({ userData, appVersion: () => app.getVersion(), sendProgress, diag, fetchIcons: net.fetch });
  const {
    settings, catalog, library, fingerprints, installer, presenceStatus, schemaService, updateImpact, cursors, adopt,
    remoteConfig, icons, toolchain, gameIcons, modPreviews, arcana,
  } = services;

  // Put the game folder right before anything is shown: where mods go, what Steam's file check
  // and a patch took while the app was closed, and the migrations older versions left behind.
  const upkeep = createGameUpkeep({
    settings, installer, library, schemaService, updateImpact, reconcileCursors: cursors.reconcileCursors, diag,
    rebuildGenerated: (ids) => arcana.rebuild(ids),
    send: (repair) => windowOpen()?.webContents.send('patch-repair', repair),
    findGame: findDotaGamePath, validGame: validateGamePath,
  });
  await upkeep.atStart();

  // Run by the uninstaller rather than by a person: ask what to take along, do it, and go.
  // Nothing below this point belongs to that: no catalog, no auto-update, no patch watcher.
  if (IS_UNINSTALL) {
    uninstallFlow({ settings, library, installer, schemaService, diag, appRoot }).open();
    diag('uninstall window up');
    return;
  }

  presets = services.presets;

  let updater: ReturnType<typeof createUpdater> | null = null;
  let patchWatcher: ReturnType<typeof createPatchWatcher> | null = null;
  // The last few things the interface said went wrong, so a report can list them separately from
  // two thousand lines of ordinary log (see diag:rendererError).
  const rendererErrors: unknown[] = [];

  /* Everything the IPC modules may ask for, in one place. What changes while the app runs (the
     window, the updater, the patch watcher, the upkeep's state) is a function read when needed. */
  const ctx: AppContext = {
    settings, catalog, installer, library, fingerprints, schemaService, updateImpact, icons, gameIcons, modPreviews,
    toolchain, remoteConfig, presets, arcana, discordAuth, portableUpdater, autoUpdater,
    // One gate, handed to every module that guards a channel with it. Two copies is how installing
    // broke once: the call went to one file and the helper stayed in the other.
    blocked: createGate({ remoteConfig, settings }),
    settingsView: settingsViewFor({
      settings, library, discordAuth, validateGamePath,
      langFolder: () => upkeep.langFolder(),
      takeMigration: () => upkeep.takeLangMigration(),
      takeSlotMigration: () => upkeep.takeSlotMigration(),
    }),

    diag, sendProgress, clampZoom, afterDeployMaster: services.afterDeployMaster, deployAndApply: services.deployAndApply,
    dotaIsRunning: () => dotaIsRunning(),
    refreshPresence: () => presenceStatus.refresh(),
    // follows the setting: turning it off tears the connection down, not just the updates
    applyPresenceSetting: () => presenceStatus.apply(),
    setPresenceView: (view) => presenceStatus.setView(view),
    // the "What's new" text for a version, out of the changelogs shipped with the build
    releaseNotes: (version, lang) => releaseNotes(version, lang, appRoot),
    repairAfterPatch: (reason) => upkeep.repairAfterPatch(reason),
    setPatchRepair: (next) => upkeep.setPatchRepair(next),
    importVpkPaths: services.importVpkPaths,
    importVpkBuffers: services.importVpkBuffers,
    adoptImportedFiles: adopt.adoptImportedFiles,
    isCursorRecord: cursors.isCursorRecord,
    disableOtherCursors: cursors.disableOtherCursors,
    disableOtherCosmetics: cursors.disableOtherCosmetics,
    applyMasterToCursors: cursors.applyMasterToCursors,
    findDotaGamePath, validateGamePath, moveLangFolder,

    IS_PORTABLE,
    // every channel is called from the window, so it is open whenever one runs; if that ever
    // stops being true this says so by name
    win: () => { if (!win) throw new Error('the main window is not open yet'); return win; },
    langFolder: () => upkeep.langFolder(),
    patchWatcher: () => patchWatcher,
    updater: () => updater,
    portableUpdate: () => (updater ? updater.portableVersion() : null),
    patchRepair: () => upkeep.patchRepair(),
    // read late: Steam's file check rewrites this while the app is running
    verifyStuck: () => upkeep.verifyStuck(),
    logFile: () => appLog.file(),
    rendererErrors: () => rendererErrors,
    lastUpdateError: () => (updater ? updater.lastError() : null),
  };

  registerIpc(ctx);
  // Launch Dota through Steam so the user's own launch options apply (-novid, -fps max, -language
  // russian all differ per user). rungameid is what pressing Play in Steam does.
  ipcMain.handle('game:launch', () => {
    // a Dota update wipes the search-path patch and moves the item table underneath our build:
    // the launch button is the last chance to notice before the game starts
    schemaService.heal();
    void shell.openExternal('steam://rungameid/570');
    return { ok: true };
  });

  // only the installed build claims the scheme: a dev run must not point the system's d2mm://
  // handler at a local electron binary
  if (app.isPackaged) {
    installDesktopEntry({ platform: process.platform, exe: process.env.APPIMAGE || process.execPath, home: app.getPath('home'), diag });
    app.setAsDefaultProtocolClient(SCHEME);
  }

  // The window (src/main-window.ts): sized to the screen, locked to the app's page, Ctrl +/-/0
  // scaling its content. Then whichever dev switch is set (src/dev-harness.ts).
  const opened = createMainWindow({
    appRoot, settings, diag,
    // dev: MM_WORKAREA=1366x728 stands in for a smaller screen (tools/sim profiles), and
    // MM_QUIET=1 keeps an automated run off the screen of whoever is using the machine
    workArea: workAreaFrom(process.env.MM_WORKAREA),
    quiet: !!process.env.MM_QUIET,
  });
  win = opened;
  attachDevHarness(opened, { diag, appRoot, quit: () => app.quit() });
  diag('createWindow done');
  // launched BY a link (cold start): the renderer has to exist before it can be told
  const cold = firstLink(process.argv);
  if (cold) opened.webContents.once('did-finish-load', () => takeLink(cold));
  presenceStatus.apply();

  /* Auto-update, packaged builds only. src/updater.ts holds it, including which channel this copy
     reads: the stable one, or the beta for an account the signed config names. The channel is a
     function rather than a value, so a tester taken off that list is back on stable at the next
     check. */
  if (autoUpdater && app.isPackaged) {
    updater = createUpdater({
      autoUpdater,
      isPortable: IS_PORTABLE,
      channel: () => channelFor({
        discordId: settings.get('account')?.id || null,
        beta: remoteConfig.beta(),
        wanted: settings.get('betaChannel') === true,
      }),
      send: (evt) => windowOpen()?.webContents.send('update', evt),
      log: diag,
    });
    updater.start();
  }

  // and from here on, notice a patch the moment it lands rather than at the next start
  patchWatcher = createPatchWatcher({
    getGamePath: () => settings.get('dotaGamePath'),
    onPatch: (evt) => upkeep.repairAfterPatch(evt),
    // safe mode off: our search path belongs in the game, so Steam's file check taking it out is a patch too
    expectsPatch: () => settings.get('schemaPatch') === true,
    log: diag,
  });
  patchWatcher.start(settings.get('gameStamp'));
  const watcher = patchWatcher;
  app.on('before-quit', () => {
    upkeep.stop();
    watcher.stop();
  });
}

/*
 * Dota 2 Mod Manager
 * Copyright (C) 2026 TheFleece
 *
 * Free software under the GNU General Public License, version 3 or later. It comes with no
 * warranty whatsoever. LICENSE holds the terms; NOTICE holds the additional terms this
 * repository adds under section 7 of that License, about credit and the program's name.
 */
const { app, ipcMain, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch { /* dev environment without the dependency installed yet */ }

const { Settings } = require('./src/settings.ts');
const { Catalog } = require('./src/catalog.ts');
const { Installer } = require('./src/installer.ts');
// under one name: main.js has a wrapper of its own called importVpkBuffers
const importer = require('./src/import.ts');
const { createCursors } = require('./src/cursors.ts');
const { createAdopt } = require('./src/adopt.ts');
const { Library } = require('./src/library.ts');
const { Fingerprints } = require('./src/fingerprints.ts');
const { SCHEME } = require('./src/preset-link.ts');
const discordAuth = require('./src/discord-auth.ts');
const { DiscordPresence } = require('./src/discord-presence.ts');
const { findDotaGamePath, validateGamePath } = require('./src/steam.ts');
const { createSchemaService } = require('./src/schema-service.ts');
const { createRemoteConfig } = require('./src/remote-config.ts');
// the download chain, so a mirror named in that signed file joins it (electron's own `net` is above)
const { applyMirrors } = require('./src/net.ts');
const { createToolchain } = require('./src/toolchain.ts');
const { createGameIcons } = require('./src/game-icons.ts');
const { createModPreviews } = require('./src/mod-preview.ts');
const { createModIdentity } = require('./src/mod-id.ts');
const portableUpdater = require('./src/portable-update.ts');
const { createUpdater } = require('./src/updater.ts');
const { channelFor } = require('./src/beta.ts');
const { gameStamp, createPatchWatcher } = require('./src/patch-watch.ts');
const { Icons } = require('./src/icons.ts');
const gamelang = require('./src/gamelang.ts');
// handed to src/ipc-settings.ts by name, the same one it has always been passed under
const { moveLangFolder } = gamelang;
const { uninstallFlow } = require('./src/uninstall-window.ts');
const { isUninstallRun } = require('./src/uninstall-args.ts');
const { presetsService } = require('./src/presets-service.ts');
const { registerPresetsIpc } = require('./src/ipc-presets.ts');
const { registerModsIpc } = require('./src/ipc-mods.ts');
const { createGate } = require('./src/feature-gate.ts');
const { registerLibraryIpc } = require('./src/ipc-library.ts');
const { registerPacksIpc } = require('./src/ipc-packs.ts');
const { registerWindowIpc } = require('./src/ipc-window.ts');
const { registerMiscIpc } = require('./src/ipc-misc.ts');
const { settingsViewFor } = require('./src/settings-view.ts');
const { registerSettingsIpc } = require('./src/ipc-settings.ts');
const { registerGameIpc } = require('./src/ipc-game.ts');
const { registerDiagnosticsIpc } = require('./src/ipc-diagnostics.ts');
const { createAppLog } = require('./src/app-log.ts');
const { releaseNotes: notesFor } = require('./src/release-notes.ts');
const { createPresenceStatus } = require('./src/presence-status.ts');
const { firstLink, handleDeepLink: takeLink, installDesktopEntry } = require('./src/deep-links.ts');
const { createMainWindow, clampZoom, workAreaFrom } = require('./src/main-window.ts');
const { attachDevHarness } = require('./src/dev-harness.ts');

/* Presets and sharing, wired once the services they use exist. Assigned in whenReady
 * below; every call site reads it late, which is the same lifetime the bare functions had
 * when they lived in this file. */
let presets;
// filled in once the services exist, below; the ipc modules are handed these by name
let isCursorRecord, disableOtherCursors, disableOtherCosmetics, applyMasterToCursors, reconcileCursors;
let adoptImportedFiles, registerImportResults;
const i18n = require('./src/i18n.ts');
const { t } = i18n;

/* Portable mode (issue #2).
 *
 * electron-builder's portable target unpacks the app into a temp folder and runs it from
 * there, setting PORTABLE_EXECUTABLE_DIR to the folder the exe was actually launched from.
 * Without using that, "portable" would only mean "no installer": the settings, the mod
 * library and the download cache would still sit in %APPDATA%, and somebody carrying the exe
 * on a stick would find none of it on the next machine. So the data goes next to the exe,
 * which is what the word promises.
 *
 * A folder that cannot be written to falls back to the ordinary location rather than failing.
 * That is what happens when the exe is dropped into Program Files, and a working app with
 * its data in the usual place beats a dead one.
 */
const IS_PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;
// The uninstaller runs the app once with this flag to ask what should go along with it, and
// reads the exit code for the answer. See the uninstall block below and build/installer.nsh.
/* Asked to put up the removal window - unless this is an update wearing the same clothes.
 *
 * An update runs the old uninstaller with --updated and /KEEP_APP_DATA, and the NSIS side
 * already stops there. This is the second lock on the same door: it went wrong once, in front
 * of everybody, and the failure mode is a person being asked whether to delete their mods
 * while they are merely updating. Both locks and the reasoning are in src/uninstall-args.ts,
 * which takes a command line so the cases can be tested without being launched. */
const IS_UNINSTALL = isUninstallRun(process.argv);
if (IS_PORTABLE) {
  try {
    const beside = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'Dota 2 Mod Manager Data');
    fs.mkdirSync(beside, { recursive: true });
    fs.accessSync(beside, fs.constants.W_OK);
    app.setPath('userData', beside);
  } catch { /* read-only folder: the default userData still works */ }
}

let win;
// what the IPC modules read the window through: every channel is called from it, so it is open
// whenever one runs, and if that ever stops being true this says so by name
const theWindow = () => { if (!win) throw new Error('the main window is not open yet'); return win; };
let settings, catalog, installer, library, fingerprints, presence, schemaService, icons, remoteConfig;
let toolchain, gameIcons, modPreviews, modId;
let presenceStatus = null; // src/presence-status.ts, once the library exists
// The folder mods are installed into, decided by the game's own audio language rather than
// by us: Korean audio means dota_koreana, Chinese means dota_schinese, and English borrows
// dota_russian because it has no folder of its own (see keepModFolder).
let langFolder = gamelang.FALLBACK_FOLDER;
// set when startup moved mods into that folder from wherever they were; the renderer
// picks it up once with settings:get and tells the user what happened
let langMigration = null;
// how many mods the one-time layout of the load order moved (installer.migrateSlotZones)
let slotMigration = null;
// fonts and cursors Steam's file check took back and the app could not put back on its own
// (the archive they came in is no longer cached), reported by mods:list
let verifyStuck = [];
// what the app did about the last Dota patch, shown as a banner in My mods
/** @type {import('./src/app-context.ts').PatchRepair} */
let patchRepair = { state: 'idle' };
let patchWatcher = null;
let repairTimer = null;

function sendProgress(evt) {
  if (win && !win.isDestroyed()) win.webContents.send('progress', evt);
}

// The window (src/main-window.ts): sized to the screen, locked to the app's page, Ctrl +/-/0
// scaling its content. Then whichever dev switch is set (src/dev-harness.ts).
function createWindow() {
  win = createMainWindow({
    appRoot: __dirname, settings, diag,
    // dev: MM_WORKAREA=1366x728 stands in for a smaller screen (tools/sim profiles), and
    // MM_QUIET=1 keeps an automated run off the screen of whoever is using the machine
    workArea: workAreaFrom(process.env.MM_WORKAREA),
    quiet: !!process.env.MM_QUIET,
  });
  attachDevHarness(win, { diag, appRoot: __dirname, quit: () => app.quit() });
}

// A small rotating log every install keeps, so a support report does not depend on reproducing
// the problem live (src/app-log.ts). MM_DIAG mirrors it for the screenshot harness.
const appLog = createAppLog({ dir: () => app.getPath('userData'), mirror: process.env.MM_DIAG || null });
const diag = (msg) => appLog.diag(msg);
const logFile = () => appLog.file();

// The last few things the interface said went wrong, so a report can list them separately
// from two thousand lines of ordinary log (see diag:rendererError).
const rendererErrors = [];

process.on('uncaughtException', (err) => diag('uncaughtException: ' + (err?.stack || err)));
process.on('unhandledRejection', (reason) => diag('unhandledRejection: ' + (/** @type {{ stack?: string }} */ (reason)?.stack || reason)));

app.whenReady().then(async () => {
  diag('whenReady');
  const userData = app.getPath('userData');
  settings = new Settings(userData);
  i18n.setLang(settings.get('uiLang'));
  catalog = new Catalog(userData);
  library = new Library(userData);
  fingerprints = new Fingerprints(userData);
  fingerprints.refresh(); // fire-and-forget: pull the latest fp -> mod map
  modId = createModIdentity({ getGamePath: () => settings.get('dotaGamePath'), log: diag });
  installer = new Installer({
    userDataDir: userData,
    getGamePath: () => settings.get('dotaGamePath'),
    getLangSuffix: () => settings.get('langSuffix'),
    onProgress: sendProgress,
    identify: (paths) => modId.identify(paths),
    publishedHash: (categoryId, file) => catalog.publishedHash(categoryId, file),
  });
  presence = new DiscordPresence({ clientId: discordAuth.CLIENT_ID, onDiag: diag });
  presenceStatus = createPresenceStatus({ presence, settings, library, installer });
  schemaService = createSchemaService({ settings, library, installer, userDataDir: userData, log: diag });
  ({ isCursorRecord, disableOtherCursors, disableOtherCosmetics, applyMasterToCursors, reconcileCursors }
    = createCursors({ installer, library, settings }));
  ({ adoptImportedFiles, registerImportResults } = createAdopt({ installer, library, schemaService }));
  // what the app can be told after it shipped: a feature switched off with a reason, and
  // dated notices. Fire-and-forget, and everything it governs stays on until it says otherwise
  remoteConfig = createRemoteConfig({ userDataDir: userData, appVersion: () => app.getVersion(), log: diag });
  /* The cached file is read before the fetch answers, so a second copy of the catalog arranged
     after this build shipped is in the chain from the first download rather than the second run. */
  applyMirrors(remoteConfig.mirrors());
  remoteConfig.refresh().then(() => applyMirrors(remoteConfig.mirrors()));
  // pictures for the cosmetics picker come through Electron's network stack (see src/icons.ts)
  icons = new Icons(userData, net.fetch);
  // ...unless the Source 2 toolchain is here, in which case they come out of the game itself
  toolchain = createToolchain({ userDataDir: userData, onProgress: sendProgress, log: diag });
  gameIcons = createGameIcons({
    userDataDir: userData,
    toolchain,
    getGamePath: () => settings.get('dotaGamePath'),
    log: diag,
  });
  // ...and the same toolchain gives a mod that came with no picture one out of itself
  modPreviews = createModPreviews({
    userDataDir: userData,
    toolchain,
    langFileOf: (relPath) => installer.langFileOnDisk(relPath),
    log: diag,
  });

  // Auto-detect on first run, and re-detect whenever the saved path stopped being a Dota
  // install - a library moved to another drive leaves the old tree behind, and writing mods
  // into it looks like success and changes nothing in the game.
  if (!validateGamePath(settings.get('dotaGamePath'))) {
    const stale = settings.get('dotaGamePath');
    const found = await findDotaGamePath();
    if (found) {
      if (stale && stale !== found) diag(`game path ${stale} is no longer an install, moved to ${found}`);
      settings.set('dotaGamePath', found);
    } else if (stale) {
      // Nothing valid anywhere. Forget the dead path rather than keep it: every write below
      // refuses without a path, and refusing is the honest answer here.
      diag(`game path ${stale} is not an install and Dota was not found; clearing it`);
      settings.set('dotaGamePath', null);
    }
  }

  // put the mods where the game will look for them, and make the game look there
  try {
    await keepModFolder();
  } catch (e) {
    diag('lang folder sync skipped: ' + e.message);
  }

  // repair "!pakNN" files left by versions before 1.0.4 (the game ignored them)
  try {
    installer.migrateLegacyPriorityPaks(library);
  } catch (e) {
    diag('legacy pak migration skipped: ' + e.message);
  }

  // The load order in two parts, once: the categories that load first in 02-29, the rest from
  // 30 (installer.js, PRIORITY_SLOTS). Renames files the game holds open while it runs, so it
  // waits for a start with Dota closed; a failure puts everything back and tries next time.
  if (settings.get('slotZones') !== 1) {
    try {
      if (await dotaIsRunning()) {
        diag('load order layout: Dota is running, trying on the next start');
      } else {
        const r = installer.migrateSlotZones(library);
        settings.set('slotZones', 1);
        if (r && r.moved) {
          slotMigration = { moved: r.moved };
          diag(`load order layout: ${r.moved} mod(s) moved into their part of the order`);
        }
      }
    } catch (e) {
      diag('load order layout skipped: ' + e.message);
    }
  }

  // fold imports that predate single-file merging (pakNN_dir.vpk + pakNN_000.vpk)
  try {
    installer.mergeMultiPartRecords(library);
  } catch (e) {
    diag('multi-part merge skipped: ' + e.message);
  }

  // put the switched-on cursor set back on disk, and stash a copy of sets installed before
  // they could be switched off at all
  try {
    reconcileCursors();
  } catch (e) {
    diag('cursor reconcile skipped: ' + e.message);
  }

  // finish what a killed process could not: a file a transaction had parked while it worked
  try {
    const swept = installer.sweepStaged();
    if (swept.restored || swept.dropped) diag(`staged files: ${swept.restored} restored, ${swept.dropped} dropped`);
  } catch (e) {
    diag('staged sweep skipped: ' + e.message);
  }

  // one-time sweep of mods installed before the schema engine existed: they still carry a
  // stale item table and a stale localization copy inside their VPK
  try {
    const m = schemaService.migrate();
    if (m.changed) diag(`schema migrate: ${m.changed}/${m.scanned} mods cleaned, ${m.deltas} blocks, ~${m.freedMB} MB freed`);
  } catch (e) {
    diag('schema migrate skipped: ' + e.message);
  }
  // cosmetic picks used to live in settings.json; move them into library records so they
  // can be toggled, deleted and shared like any other mod
  try {
    schemaService.migrateCosmeticSettings();
  } catch (e) {
    diag('cosmetic migrate skipped: ' + e.message);
  }

  // a Dota update overwrites the patched gameinfo and moves the item table: put both
  // back before the user gets a chance to launch the game with a half-applied setup
  const startupHealed = [];
  let startupError = null;
  try {
    const healed = schemaService.heal();
    if (healed.healed && healed.healed.length) { startupHealed.push(...healed.healed); diag('schema healed: ' + healed.healed.join(',')); }
    if (healed.error) { startupError = healed.error; diag('schema heal failed: ' + healed.error); }
  } catch (e) {
    startupError = e.message;
    diag('schema heal skipped: ' + e.message);
  }

  // the same job for the two kinds of mod that overwrite files Valve ships
  try {
    if (restoreAfterVerify()) startupHealed.push('files');
  } catch (e) {
    diag('restore after verify skipped: ' + e.message);
  }

  // Did the game change while the app was closed? The repair for it has just run either
  // way - this only decides whether the user is told about it, and hands the watcher the
  // build to compare against.
  try {
    const stamp = gameStamp(settings.get('dotaGamePath'));
    const known = settings.get('gameStamp');
    if (stamp && known && stamp !== known) {
      diag(`Dota changed while the app was closed: ${known} -> ${stamp}`);
      patchRepair = { state: startupError ? 'failed' : 'done', healed: startupHealed, error: startupError, at: Date.now() };
    }
    if (stamp) settings.set('gameStamp', stamp);
  } catch (e) {
    diag('build check skipped: ' + e.message);
  }

  // Run by the uninstaller rather than by a person: ask what to take along, do it, and go.
  // Nothing below this point belongs to that - no catalog, no auto-update, no patch watcher.
  if (IS_UNINSTALL) {
    uninstallFlow({
      settings, library, installer, schemaService, diag, appRoot: __dirname,
    }).open();
    diag('uninstall window up');
    return;
  }

  presets = presetsService({ catalog, installer, library, schemaService, deployAndApply });

  registerIpc();
  // only the installed build claims the scheme — a dev run must not point the system's
  // d2mm:// handler at a local electron binary
  if (app.isPackaged) {
    installDesktopEntry({
      platform: process.platform, exe: process.env.APPIMAGE || process.execPath, home: app.getPath('home'), diag,
    });
    app.setAsDefaultProtocolClient(SCHEME);
  }
  createWindow();
  diag('createWindow done');
  // launched BY a link (cold start): the renderer has to exist before it can be told
  const cold = firstLink(process.argv);
  if (cold) win.webContents.once('did-finish-load', () => handleDeepLink(cold));
  applyPresenceSetting();
  setupAutoUpdate();

  // and from here on, notice a patch the moment it lands rather than at the next start
  patchWatcher = createPatchWatcher({
    getGamePath: () => settings.get('dotaGamePath'),
    onPatch: (evt) => repairAfterPatch(evt),
    // safe mode off: our search path belongs in the game, so Steam's file check taking it out is a patch too
    expectsPatch: () => settings.get('schemaPatch') === true,
    log: diag,
  });
  patchWatcher.start(settings.get('gameStamp'));
}).catch((e) => diag('whenReady FAIL: ' + (e.stack || e)));

/* ---- auto-update (packaged builds only) ----
 *
 * src/updater.ts holds it, including which channel this copy reads: the stable one, or the beta
 * for an account the signed config names. The channel is a function rather than a value, so a
 * tester taken off that list is back on stable at the next check.
 */
let updater = null;
function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return;
  updater = createUpdater({
    autoUpdater,
    isPortable: IS_PORTABLE,
    channel: () => channelFor({
      discordId: (settings.get('account') || {}).id || null,
      beta: remoteConfig.beta(),
      wanted: settings.get('betaChannel') === true,
    }),
    send: (evt) => { if (win && !win.isDestroyed()) win.webContents.send('update', evt); },
    log: diag,
  });
  updater.start();
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  clearTimeout(repairTimer);
  if (patchWatcher) patchWatcher.stop();
});

// ---------- d2mm:// links ----------

// A preset link clicked anywhere on the system (src/deep-links.ts): parked in Presets, never
// installed from the link itself.
const handleDeepLink = (url) => takeLink(url, {
  importPresetLink: (code) => presets.importPresetLink(code),
  win: () => win,
});

// One running copy only — two instances writing manifest.json would race each other, and
// a link clicked while the app is open must reach the window that already exists.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    handleDeepLink(firstLink(argv));
  });
  app.on('open-url', (e, url) => { e.preventDefault(); handleDeepLink(url); }); // macOS
}

// the "What's new" text for a version, out of the changelogs shipped with the build
const releaseNotes = (version, lang) => notesFor(version, lang, app.getAppPath());

// Two counted passes over the same batch: the files land, then each one is read. Both are
// shown on the one bar, so a long import says which mod it is on instead of nothing at all.
function importStep(stage) {
  return (done, total) => sendProgress({ type: 'count', label: stage, done, total });
}

// Copy what the user handed over into the lang folder and register it in the library. The two
// ways in differ only in which importer reads them, so they share the bar, the error and the
// "done" that has to arrive whichever way it ends.
async function runImport(take, input) {
  try {
    const staged = await take(installer, input, importStep(t('Копирование модов')));
    return await registerImportResults(staged, importStep(t('Разбор модов')));
  } catch (err) {
    return { error: String(err.message || err) };
  } finally {
    sendProgress({ type: 'done' });
  }
}

const importVpkPaths = (paths) => runImport(importer.importVpks, Array.isArray(paths) ? paths : []);
// from raw bytes: the drag-and-drop fallback for when a real path cannot be resolved
const importVpkBuffers = (items) => runImport(importer.importVpkBuffers, Array.isArray(items) ? items : []);

// ---------- item schema (game/dota_mods) ----------
// The engine reads scripts/items/items_game.txt through the MOD path - the game's own dota
// folder - so nothing in a language folder can override it. Mods therefore never ship their
// copy: src/schema-service.ts lifts the blocks they changed and splices them into the game's
// CURRENT table. Everything below is a thin call into that service.

// Whether toggling/removing this record can change what belongs in the built schema: a mod
// with lifted item blocks, or a cosmetic pick (which IS a schema edit, not a file).
// after any deploy, if the master switch is off, sweep freshly written files off too
function afterDeployMaster() {
  try { if (installer.masterIsOff()) installer.setMasterEnabled(false); } catch { /* noop */ }
}

// rebuild a pack's deployed VPK, persist its files, and re-apply pack + master off-state
function deployAndApply(pack) {
  const { files, conflicts } = installer.deployPack(pack);
  library.update(pack.id, { files, members: pack.members });
  if (pack.enabled === false && files.length) { try { installer.setEnabled(files, false); } catch { /* noop */ } }
  afterDeployMaster();
  return conflicts;
}

// ---------- Discord presence ----------

const refreshPresence = () => presenceStatus?.refresh();
// follows the setting: turning it off tears the connection down, not just the updates
const applyPresenceSetting = () => presenceStatus?.apply();

// Dota reads boot.vcfg once at startup and rewrites it on exit, so language changes must be
// made while it is closed or the game would just overwrite them.
//
// Two answers to one question, because Windows and Linux have nothing in common here: one
// filters a table by image name, the other matches a process name exactly (pgrep -f would
// also match the Steam command line that mentions the game, and every browser tab about it).
// A missing tool answers "not running", which is what this returned on any non-Windows
// machine before there was a second branch at all.
function dotaIsRunning() {
  const [cmd, args, hit] = process.platform === 'win32'
    ? ['tasklist', ['/FI', 'IMAGENAME eq dota2.exe', '/NH'], /dota2\.exe/i]
    : ['pgrep', ['-x', 'dota2'], /\d/];
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout) => {
      resolve(!err && hit.test(stdout || ''));
    });
  });
}

/* Mods follow the game's audio language instead of the game following us.
 *
 * The engine mounts the folder named by that language, so the mod folder is not a preference,
 * it is a consequence of a setting somewhere else. Three of Dota's four voice languages have a
 * folder, so somebody playing with Korean or Chinese speech keeps it and their mods go into
 * dota_koreana or dota_schinese. Nothing is asked and nothing is changed.
 *
 * English is the one that has to move, because it has no folder at all and Valve's gameinfo
 * mounts no language path for it. Those users get dota_russian written into the audio setting,
 * and they hear no difference: Steam decides what is downloaded and Dota decides what is
 * mounted, so a folder with no voice pack in it mounts with our mods and the speech keeps
 * coming out of dota/pak01, in English.
 *
 * The text language stays untouched. It is the one the user picked when they installed the
 * game, and nothing about mods depends on it.
 *
 * Dota rewrites boot.vcfg when it exits, so a running game means we try again next launch.
 */
async function keepModFolder() {
  const game = settings.get('dotaGamePath');
  if (!game) return;
  const lang = gamelang.detectLangSuffix(game);
  const launched = gamelang.launchLanguage(game);
  const chosen = gamelang.modFolderFor(launched, lang.suffix);
  langFolder = chosen.suffix;

  /* A launch option is not ours to overrule. While `-language X` is set the engine reads
   * dota_X whatever boot.vcfg says, so the app follows it instead of setting the voice
   * language back on every start and leaving mods in a folder nobody mounts. That is also the
   * arrangement that lets this run alongside Minify: it puts the parameter there, and both
   * sets of mods end up in the one folder the game reads. */
  if (chosen.followed) {
    diag(`launch option -language ${langFolder}: following it instead of setting the voice language`);
  } else if (lang.suffix !== langFolder) {
    if (await dotaIsRunning()) {
      diag(`audio language is ${lang.suffix}, Dota is running - leaving boot.vcfg alone`);
      return;
    }
    gamelang.writeBootLanguages(game, { audio: langFolder });
    diag(`audio language ${lang.suffix} -> ${langFolder}`);
  }
  gamelang.ensureLangFolder(game, langFolder);
  // whatever the mods were following before: our own last setting, and the folder the game
  // was mounting until a moment ago
  let moved = 0;
  const from = new Set([settings.get('langSuffix'), lang.suffix].filter((s) => s && s !== langFolder));
  for (const old of from) moved += moveLangFolder(game, old, langFolder);
  if (moved) {
    langMigration = { from: [...from][0], to: langFolder, moved };
    diag(`mods moved into dota_${langFolder}: ${moved} files from ${[...from].join(', ')}`);
  }
  settings.set('langSuffix', langFolder);
}

/* Put back what Steam's file check took away.
 *
 * Only fonts and cursors can be taken: they overwrite files Valve ships. What can be restored
 * from what the app already holds is restored without a word - it is the state the user asked
 * for, and they did not ask Steam to undo it. What would need downloading is left alone and
 * reported instead: starting a download at launch because a file changed is not something to
 * do behind somebody's back.
 */
function restoreAfterVerify() {
  const lost = installer.lostToVerify(library.list());
  if (!lost.length) return 0;
  const stuck = [];
  let restored = 0;
  for (const rec of lost) {
    try {
      const from = installer.restoreDeployed(rec);
      if (from) { restored++; diag(`restored after verify: ${rec.name} (from ${from})`); }
      else stuck.push({ id: rec.id, name: rec.name });
    } catch (err) {
      diag(`restore failed for ${rec.name}: ${err.message}`);
      stuck.push({ id: rec.id, name: rec.name });
    }
  }
  verifyStuck = stuck;
  return restored;
}

/* Everything the app puts back after the game changed underneath it.
 *
 * Not one line of the repair itself is new: heal() re-applies the search-path patch and
 * rebuilds the item schema and restoreAfterVerify() puts fonts and cursors back. What 4.1
 * adds is when this runs and
 * that somebody hears about it - before, it happened at startup and on our own Play button,
 * while Steam patches the game in the background and most people press Play in Steam.
 *
 * Nothing is written while Dota is running. It holds gameinfo and its paks open, so a write
 * would half-succeed, and the client has already read the files anyway. The app says it is
 * waiting and tries again after the game exits.
 */
const REPAIR_RETRY_MS = 20000;

function setPatchRepair(next) {
  patchRepair = next;
  if (win && !win.isDestroyed()) win.webContents.send('patch-repair', patchRepair);
}

async function repairAfterPatch(reason) {
  const game = settings.get('dotaGamePath');
  if (!game) return;
  clearTimeout(repairTimer);
  repairTimer = null;

  if (await dotaIsRunning()) {
    diag('Dota patched while the game is running - repair deferred');
    setPatchRepair({ state: 'waiting', reason, at: Date.now() });
    repairTimer = setTimeout(() => { repairAfterPatch(reason); }, REPAIR_RETRY_MS);
    return;
  }

  const healed = [];
  let error = null;
  try {
    const res = schemaService.heal();
    if (res.healed) healed.push(...res.healed);
    if (res.error) error = res.error;
  } catch (err) {
    error = String(err.message || err);
  }
  try {
    if (restoreAfterVerify()) healed.push('files');
  } catch (err) {
    diag('restore after verify skipped: ' + err.message);
  }
  // remembered only now: a stamp stored before a failed repair would make the next start
  // think there is nothing to fix
  settings.set('gameStamp', gameStamp(game));
  diag(`repair after patch: ${healed.join(',') || 'nothing to do'}${error ? ' error=' + error : ''}`);
  setPatchRepair({ state: error ? 'failed' : 'done', healed, error, at: Date.now() });
}

function registerIpc() {
  // ----- window controls ----- (src/ipc-window.ts)
  registerWindowIpc({
    IS_PORTABLE, autoUpdater, clampZoom, diag, portableUpdater,
    portableUpdate: () => (updater ? updater.portableVersion() : null),
    releaseNotes, sendProgress, settings, win: theWindow,
  });

  // What the Settings screen is told, computed in src/settings-view.ts. The two pieces of
  // state it reads are handed over as functions, because both change while the app runs.
  const settingsView = settingsViewFor({
    settings,
    library,
    discordAuth,
    validateGamePath,
    langFolder: () => langFolder,
    takeMigration: () => { const m = langMigration; langMigration = null; return m; },
    takeSlotMigration: () => { const m = slotMigration; slotMigration = null; return m; },
  });

  // ----- settings ----- (src/ipc-settings.ts)
  registerSettingsIpc({
    applyPresenceSetting, catalog, discordAuth, findDotaGamePath, library, moveLangFolder,
    presence, refreshPresence, remoteConfig, settings, settingsView, validateGamePath,
    updater: () => updater,
    langFolder: () => langFolder,
    patchWatcher: () => patchWatcher,
    setPresenceView: (v) => presenceStatus?.setView(v),
    win: theWindow,
  });

  // One gate, handed to both of the modules that guard a channel with it. Two copies is how
  // installing broke: the call went to one file and the helper stayed in the other.
  const blocked = createGate({ remoteConfig, settings });

  // ----- install/manage ----- (src/ipc-mods.ts)
  registerModsIpc({
    applyMasterToCursors, blocked, catalog, diag, disableOtherCursors, fingerprints,
    importVpkBuffers, importVpkPaths, installer, isCursorRecord, library, refreshPresence,
    schemaService, sendProgress, win: theWindow,
    // read late: Steam's verify rewrites this while the app is running
    verifyStuck: () => verifyStuck,
  });

  // ----- launch -----
  // Launch Dota via Steam so the user's own launch options apply (-novid, -fps max,
  // -language russian … differ per user). rungameid mirrors clicking Play in Steam.
  ipcMain.handle('game:launch', () => {
    // a Dota update wipes the search-path patch and moves the item table underneath our
    // build: the launch button is the last chance to notice before the game starts
    schemaService.heal();
    shell.openExternal('steam://rungameid/570');
    return { ok: true };
  });

  // ----- what the app was told from the network ----- (src/ipc-game.ts)
  registerGameIpc({
    blocked, diag, dotaIsRunning, gameIcons, icons, library, modPreviews, remoteConfig,
    repairAfterPatch, schemaService, settings, toolchain,
    patchRepair: () => patchRepair,
    setPatchRepair,
  });

  // ----- managing what is installed ----- (src/ipc-library.ts)
  registerLibraryIpc({
    applyMasterToCursors, catalog, disableOtherCosmetics, disableOtherCursors, fingerprints,
    installer, isCursorRecord, library, refreshPresence, schemaService,
  });

  // ----- combined packs ----- (src/ipc-packs.ts)
  registerPacksIpc({ afterDeployMaster, deployAndApply, installer, library });

  // ----- presets ----- (src/ipc-presets.ts)
  registerPresetsIpc({
    win: theWindow, settings, catalog, installer, library, schemaService, presets,
    adoptImportedFiles, afterDeployMaster, disableOtherCursors, sendProgress,
  });

  // ----- misc ----- (src/ipc-misc.ts)
  registerMiscIpc({ installer, library });

  // ----- diagnostics ----- (src/ipc-diagnostics.ts)
  registerDiagnosticsIpc({
    autoUpdater, catalog, diag, dotaIsRunning, icons, installer, library, logFile, remoteConfig,
    schemaService, settings, toolchain,
    win: theWindow,
    rendererErrors: () => rendererErrors,
    lastUpdateError: () => (updater ? updater.lastError() : null),
  });
}

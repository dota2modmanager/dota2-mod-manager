/*
 * Dota 2 Mod Manager
 * Copyright (C) 2026 TheFleece
 *
 * Free software under the GNU General Public License, version 3 or later. It comes with no
 * warranty whatsoever. LICENSE holds the terms; NOTICE holds the additional terms this
 * repository adds under section 7 of that License, about credit and the program's name.
 */
const { app, BrowserWindow, ipcMain, shell, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch { /* dev environment without the dependency installed yet */ }

const { Settings } = require('./src/settings.ts');
const { Catalog } = require('./src/catalog.ts');
const { Installer } = require('./src/installer');
// under one name: main.js has a wrapper of its own called importVpkBuffers
const importer = require('./src/import');
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
// handed to src/ipc-settings.js by name, the same one it has always been passed under
const { moveLangFolder } = gamelang;
const { uninstallFlow } = require('./src/uninstall-window');
const { isUninstallRun } = require('./src/uninstall-args.ts');
const { presetsService } = require('./src/presets-service.ts');
const { registerPresetsIpc } = require('./src/ipc-presets');
const { registerModsIpc } = require('./src/ipc-mods');
const { createGate } = require('./src/feature-gate.ts');
const { registerLibraryIpc } = require('./src/ipc-library');
const { registerPacksIpc } = require('./src/ipc-packs');
const { registerWindowIpc } = require('./src/ipc-window');
const { registerMiscIpc } = require('./src/ipc-misc');
const { settingsViewFor } = require('./src/settings-view.ts');
const { registerSettingsIpc } = require('./src/ipc-settings');
const { registerGameIpc } = require('./src/ipc-game');
const { registerDiagnosticsIpc } = require('./src/ipc-diagnostics');

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
let settings, catalog, installer, library, fingerprints, presence, schemaService, icons, remoteConfig;
let toolchain, gameIcons, modPreviews, modId;
let presenceView = 'catalog';
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
// what the app did about the last Dota patch, shown as a banner in My mods:
// { state: 'idle' | 'waiting' | 'done' | 'failed', healed: string[], error?, at }
let patchRepair = { state: 'idle' };
let patchWatcher = null;
let repairTimer = null;

function sendProgress(evt) {
  if (win && !win.isDestroyed()) win.webContents.send('progress', evt);
}

// UI scale, kept inside a range where the layout still holds together
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.6;
function clampZoom(v) {
  const z = Number(v);
  if (!Number.isFinite(z) || z <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/* The window has to fit the screen it opens on.
 *
 * 1360x860 is the size this is designed at, and on a 1366x768 laptop - still one of the most
 * common screens there is - a window 860 tall does not fit a work area about 730 tall. Windows
 * places it anyway and the bottom of it sits under the taskbar or past the edge of the screen,
 * where the launch bar and the last rows of a list are. Nothing is broken and nothing scrolls
 * wrong; the part of the window holding them is simply not on the screen, which reads exactly
 * like a page that stops scrolling partway. A restart does not help, because the size is not
 * remembered from the last run - it is asked for again every time.
 *
 * Display scaling makes it worse rather than better: at 150% a 1080p screen reports a work area
 * around 1280x680, so a machine whose specification looks roomy has less room than the laptop.
 *
 * The minimums are clamped too. A minimum taller than the screen is not a floor, it is a
 * guarantee of the same overflow, and it takes away the one thing the person can do about it.
 */
function windowFit() {
  const fallback = { width: 1360, height: 860, minWidth: 1020, minHeight: 640 };
  try {
    // dev: MM_WORKAREA=1366x728 stands in for a smaller screen (tools/sim profiles)
    const fake = /^(\d+)x(\d+)$/.exec(process.env.MM_WORKAREA || '');
    const { width: aw, height: ah } = fake ? { width: +fake[1], height: +fake[2] } : screen.getPrimaryDisplay().workAreaSize;
    if (!(aw > 0 && ah > 0)) return fallback;
    return {
      width: Math.min(fallback.width, aw),
      height: Math.min(fallback.height, ah),
      minWidth: Math.min(fallback.minWidth, aw),
      minHeight: Math.min(fallback.minHeight, ah),
    };
  } catch {
    return fallback; // no display info: better the designed size than no window at all
  }
}

function createWindow() {
  win = new BrowserWindow({
    ...windowFit(),
    backgroundColor: '#050506',
    autoHideMenuBar: true,
    frame: false,
    // dev: MM_QUIET=1 keeps an automated run off the screen of whoever is using the machine.
    // Undefined anywhere but a measuring run, so the app opens exactly as it always did.
    //
    // A window that was never shown produces no frames, and a view transition waits for one:
    // time-from-click-to-visible reads in seconds here and means nothing. Measure the main
    // thread (the gap between timer ticks) instead, which is what a frozen window actually is.
    show: !process.env.MM_QUIET,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const appPage = path.join(__dirname, 'renderer', 'index.html');
  win.loadFile(appPage);

  /* The window shows one page and never another.
   *
   * A preload script is attached to the webContents, not to the document, so a page the
   * window navigates to inherits window.api - the whole IPC surface, install and runTool
   * included. Nothing in the app navigates anywhere, but the catalog's own HTML lands in
   * the interface (guides), and one <meta http-equiv="refresh"> in it would be enough to
   * hand that surface to whoever wrote the markup. CSP does not cover navigation, so this
   * does: the app's own file is the only thing this window is allowed to load, and a link
   * that wants a browser gets the browser.
   */
  const appUrl = pathToFileURL(appPage).href;
  const leavesForBrowser = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  };
  win.webContents.on('will-navigate', (event, url) => {
    if (url === appUrl) return; // a reload of the page itself
    event.preventDefault();
    diag(`blocked navigation to ${String(url).slice(0, 200)}`);
    leavesForBrowser(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    diag(`blocked window.open to ${String(url).slice(0, 200)}`);
    leavesForBrowser(url);
    return { action: 'deny' };
  });
  // A webview or a nested frame would be a second way in with the same preload on it.
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));

  // Ctrl +/-/0 scale the content. Handled here rather than in the renderer because
  // preventDefault() at this point also swallows Electron's built-in zoom accelerators —
  // those zoom the whole window, panels included, which is exactly what we don't want.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt) return;
    const cur = clampZoom(settings.get('uiScale'));
    let z = null;
    if (input.key === '=' || input.key === '+') z = clampZoom(cur + 0.05);
    else if (input.key === '-' || input.key === '_') z = clampZoom(cur - 0.05);
    else if (input.key === '0') z = 1;
    if (z === null) return;
    event.preventDefault();
    settings.set('uiScale', z);
    win.webContents.send('ui:zoom', z); // the renderer owns the scale itself
  });

  // dev: MM_SHOT=<path> saves a screenshot after load (used for automated UI checks)
  if (process.env.MM_SHOT) {
    win.webContents.once('did-finish-load', () => {
      diag('did-finish-load');
      setTimeout(async () => {
        diag('capture start');
        try {
          // MM_QUIET=1: measure without the window jumping in front of whatever the person
          // at the keyboard is doing. The window is created hidden in that mode, so a run
          // after numbers rather than a picture never takes over the screen.
          if (!process.env.MM_QUIET) {
            win.show();
            win.focus();
          }
          if (process.env.MM_VIEW) {
            await win.webContents.executeJavaScript(
              `document.querySelector('[data-view="${process.env.MM_VIEW}"]')?.click()`);
            await new Promise((r) => setTimeout(r, 2500));
          }
          if (process.env.MM_CAT) {
            await win.webContents.executeJavaScript(
              `document.querySelector('.rail-item[data-cat="${process.env.MM_CAT}"]')?.click()`);
            await new Promise((r) => setTimeout(r, 2500));
          }
          if (process.env.MM_SEARCH) {
            // dev-only: type into the title-bar search (its handler is debounced)
            await win.webContents.executeJavaScript(`(() => {
              const el = document.getElementById('globalSearch');
              if (!el) return;
              el.value = ${JSON.stringify(process.env.MM_SEARCH)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
            })()`);
            await new Promise((r) => setTimeout(r, 2500));
          }
          if (process.env.MM_CLICK) {
            // dev-only: click a comma-separated list of CSS selectors before capture
            for (const sel of process.env.MM_CLICK.split('||')) {
              await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel)})?.click()`);
              await new Promise((r) => setTimeout(r, 700));
            }
          }
          if (process.env.MM_HOVER) {
            // dev-only: park the pointer over a selector (or "x,y") so the shot shows the
            // hover state. Half of what a card does only exists under the cursor, and a
            // screenshot of the resting state cannot show a control that slides on hover.
            const spec = process.env.MM_HOVER;
            let point = null;
            if (/^\d+\s*,\s*\d+$/.test(spec)) {
              const [x, y] = spec.split(',').map(Number);
              point = { x, y };
            } else {
              point = await win.webContents.executeJavaScript(`(() => {
                const el = document.querySelector(${JSON.stringify(spec)});
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              })()`);
            }
            if (point) {
              // two moves: the first lands, the second keeps the pointer there after any
              // relayout the first one caused
              win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
              await new Promise((r) => setTimeout(r, 250));
              win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
              await new Promise((r) => setTimeout(r, 600));
            }
          }
          if (process.env.MM_DRAG) {
            // dev-only: press, move, release — "x1,y1,x2,y2" (drags a grip, swipes a strip)
            const [x1, y1, x2, y2] = process.env.MM_DRAG.split(',').map(Number);
            win.webContents.sendInputEvent({ type: 'mouseDown', x: x1, y: y1, button: 'left', clickCount: 1 });
            for (let i = 1; i <= 12; i++) {
              win.webContents.sendInputEvent({
                type: 'mouseMove', button: 'left',
                x: Math.round(x1 + ((x2 - x1) * i) / 12), y: Math.round(y1 + ((y2 - y1) * i) / 12),
              });
              await new Promise((r) => setTimeout(r, 30));
            }
            win.webContents.sendInputEvent({ type: 'mouseUp', x: x2, y: y2, button: 'left', clickCount: 1 });
            await new Promise((r) => setTimeout(r, 500));
          }
          if (process.env.MM_WHEEL) {
            // dev-only: wheel ticks at a point — "x,y,deltaY[,ctrl]", several split by ";"
            for (const spec of process.env.MM_WHEEL.split(';')) {
              const [x, y, dy, mod] = spec.split(',').map((v) => v.trim());
              win.webContents.sendInputEvent({
                type: 'mouseWheel', x: Number(x), y: Number(y),
                deltaX: 0, deltaY: Number(dy), canScroll: true,
                modifiers: mod === 'ctrl' ? ['control'] : [],
              });
              await new Promise((r) => setTimeout(r, 400));
            }
          }
          if (process.env.MM_UPDATE) {
            // dev-only: MM_UPDATE=portable:2.3.0 raises the update bar without waiting for a
            // real release, so the three states it can be in stay checkable from a screenshot
            const [type, version] = String(process.env.MM_UPDATE).split(':');
            win.webContents.send('update', { type, version: version || '0.0.0' });
            await new Promise((r) => setTimeout(r, 900));
          }
          if (process.env.MM_SCROLL) {
            // dev-only: scroll the scrollable pane by N px before capture (long views)
            await win.webContents.executeJavaScript(`(() => {
              const el = [...document.querySelectorAll('#main, *')].find((e) =>
                e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY));
              (el || document.scrollingElement).scrollBy(0, ${Number(process.env.MM_SCROLL) || 0});
            })()`);
            await new Promise((r) => setTimeout(r, 600));
          }
          if (process.env.MM_MODAL) {
            await win.webContents.executeJavaScript(`
              [...document.querySelectorAll('.card .card-name')]
                .find(n => n.textContent.trim() === ${JSON.stringify(process.env.MM_MODAL)})
                ?.closest('.card')?.click()`);
            await new Promise((r) => setTimeout(r, 1500));
            if (process.env.MM_PREVIEW) {
              await win.webContents.executeJavaScript(`document.getElementById('previewPlayBtn')?.click()`);
              await new Promise((r) => setTimeout(r, 2500));
            }
          }
          if (process.env.MM_EVAL) {
            // dev-only: read the finished DOM and write the answer beside the screenshot.
            // A picture cannot say whether a fold opened with the right text in the right
            // language, and that is exactly the kind of thing that ships broken.
            const out = await win.webContents.executeJavaScript(`(async () => {
              ${process.env.MM_EVAL}
            })()`);
            fs.writeFileSync(`${process.env.MM_SHOT}.eval.json`, JSON.stringify(out, null, 1));
          }
          await new Promise((r) => setTimeout(r, 500));
          // a runner's xvfb sometimes has no frame to hand over yet (UnknownVizError): src/capture.ts
          const { captureWithRetry } = require('./src/capture.ts');
          const img = await captureWithRetry(() => win.webContents.capturePage(), { log: diag });
          fs.writeFileSync(process.env.MM_SHOT, img.toPNG());
          diag('capture done ' + img.getSize().width + 'x' + img.getSize().height);
        } catch (e) {
          fs.writeFileSync(process.env.MM_SHOT + '.err.txt', String(e));
        }
      }, 7000);
    });
  }

  // dev: MM_SIM=<scenarios> drives the window through tools/sim (tools/sim/driver.js attach)
  if (process.env.MM_SIM) require('./tools/sim/driver').attach(win);
  // dev: MM_REC=<dir> films the app running a scripted scene, one webm per scene. The site
  // needs a clip of the app working and will need a fresh one every release, so it is a
  // script rather than something recorded by hand. MM_SCENE picks scenes by name.
  // Everything it needs lives in tools/screencast.js, loaded only on this branch.
  if (process.env.MM_REC) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const log = (m) => process.stdout.write(`${m}\n`);
        let cast = null;
        try {
          const { Cast } = require('./tools/screencast');
          const scenes = require('./tools/screencast-scenes');
          win.show();
          win.focus();
          cast = new Cast(win, { out: process.env.MM_REC });
          log(`cast ready ${JSON.stringify(await cast.setup())}`);
          const only = process.env.MM_SCENE ? process.env.MM_SCENE.split(',') : null;
          for (const [name, build] of Object.entries(scenes)) {
            if (only && !only.includes(name)) continue;
            const steps = typeof build === 'function' ? await build(cast, log) : build;
            await cast.scene(name, steps, log);
          }
        } catch (e) {
          log(`cast failed: ${(e && e.stack) || e}`);
        }
        if (cast) cast.close();
        app.quit();
      }, 9000);
    });
  }
}

// A small rotating log every install keeps, so a support report (see src/diagnostics.ts and
// the diag:export handler below) doesn't depend on reproducing the problem live. MM_DIAG is
// a separate, opt-in mirror to an arbitrary path, used only by the screenshot test harness.
let _logFile = null;
function logFile() {
  if (!_logFile) _logFile = path.join(app.getPath('userData'), 'logs', 'app.log');
  return _logFile;
}
const LOG_MAX_BYTES = 1024 * 1024;
function appendLog(line) {
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { if (fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, file + '.1'); } catch { /* first write */ }
    fs.appendFileSync(file, line);
  } catch { /* logging must never be why the app crashes */ }
}

// The last few things the interface said went wrong, so a report can list them separately
// from two thousand lines of ordinary log (see diag:rendererError).
const rendererErrors = [];

const DIAG = process.env.MM_DIAG;
function diag(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  appendLog(line);
  if (DIAG) { try { fs.appendFileSync(DIAG, line); } catch { /* noop */ } }
}

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
    installDesktopEntry();
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

/* Linux has to be told this program exists before it can send it a link.
 *
 * On Windows the installer registers the scheme and on macOS the bundle declares it, but an
 * AppImage is one file somebody copied into a folder, and the session knows nothing about it.
 * The convention is a .desktop file in ~/.local/share/applications describing the program and
 * the schemes it handles, pointing at the file the user actually ran, which is what $APPIMAGE
 * holds. setAsDefaultProtocolClient below then has something to point d2mm:// at.
 *
 * Best effort on purpose. A read-only home, a distribution with no update-desktop-database, a
 * desktop environment that ignores the directory: each of those ends with the app running
 * normally and preset links opening nothing, which is where Linux stood before this existed.
 */
function installDesktopEntry() {
  if (process.platform !== 'linux') return;
  const exe = process.env.APPIMAGE || process.execPath;
  try {
    const dir = path.join(app.getPath('home'), '.local', 'share', 'applications');
    const file = path.join(dir, 'dota2-mod-manager.desktop');
    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Dota 2 Mod Manager',
      'Comment=Mods for Dota 2, without the file juggling',
      // %u passes the clicked link through; the quotes are for a path with a space in it
      `Exec="${exe}" %u`,
      'Icon=dota2-mod-manager',
      'Categories=Game;',
      'Terminal=false',
      `MimeType=x-scheme-handler/${SCHEME};application/x-d2mm;`,
      '',
    ].join('\n');

    if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8') === entry) return;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, entry);
    // Missing on a minimal system, and the file still counts on most desktops without it.
    execFile('update-desktop-database', [dir], () => {});
    diag('desktop entry written: ' + file);
  } catch (e) {
    diag('desktop entry skipped: ' + e.message);
  }
}

// A preset link clicked anywhere on the system lands here. Nothing installs: it parks in
// the Presets tab exactly like a dropped file, and the user decides.
function handleDeepLink(url) {
  if (!url || !url.startsWith(`${SCHEME}://`)) return;
  const res = presets.importPresetLink(url.replace(new RegExp(`^${SCHEME}://preset/`), ''));
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    win.webContents.send('preset-link', res);
  }
}

const firstLink = (argv) => (argv || []).find((a) => typeof a === 'string' && a.startsWith(`${SCHEME}://`));

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

// register what src/import.js handed back into the library
/**
 * The changelog section for one version, in the app's language when there is a translation.
 * The same file CI puts on the release page, shipped with the build so the screen works
 * offline and needs no GitHub call.
 * @returns {string|null} markdown, or null when this version has no section
 */
function releaseNotes(version, lang) {
  const files = lang === 'ru' ? ['CHANGELOG.ru.md', 'CHANGELOG.md'] : ['CHANGELOG.md'];
  const head = new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^-0-9A-Za-z.].*)?$`, 'm');
  for (const name of files) {
    let text;
    try { text = fs.readFileSync(path.join(app.getAppPath(), name), 'utf-8'); } catch { continue; }
    const m = head.exec(text);
    if (!m) continue;
    const rest = text.slice(m.index + m[0].length);
    const next = /^## /m.exec(rest);
    const body = (next ? rest.slice(0, next.index) : rest).trim();
    if (body) return body;
  }
  return null;
}

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

const PRESENCE_VIEWS = {
  catalog: 'Смотрит каталог модов',
  library: 'В своей библиотеке',
  presets: 'Собирает пресет',
  cosmetics: 'Выбирает косметику',
  tools: 'В инструментах',
  guides: 'Читает гайды',
  settings: 'В настройках',
};

// The status is written in the language the user chose for the app: their friends read it,
// and that is the only language signal we have about them.
function presenceActivity() {
  let mods = 0;
  let masterOff = false;
  try {
    mods = library.list().filter((r) => r.enabled).length;
    // the master switch renames files rather than clearing each record's own flag, so the
    // per-mod count still reads "on" while nothing is actually loading
    masterOff = installer.masterIsOff();
  } catch { /* no library or no game path yet */ }
  let state = t('Ещё без модов');
  if (masterOff) state = t('Моды выключены');
  else if (mods) state = t('{0} модов включено', mods);
  return {
    details: t(PRESENCE_VIEWS[presenceView] || PRESENCE_VIEWS.catalog),
    state,
    buttons: [{ label: t('Скачать Mod Manager'), url: 'https://dota2modmanager.com/' }],
  };
}

function refreshPresence() {
  if (presence && presence.enabled) presence.set(presenceActivity());
}

// Follows the setting: turning it off tears the connection down, not just the updates.
function applyPresenceSetting() {
  if (!presence) return;
  if (settings.get('discordPresence') === false) { presence.stop(); return; }
  presence.start();
  refreshPresence();
}


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
  // ----- window controls ----- (src/ipc-window.js)
  registerWindowIpc({
    IS_PORTABLE, autoUpdater, clampZoom, diag, portableUpdater,
    portableUpdate: () => (updater ? updater.portableVersion() : null),
    releaseNotes, sendProgress, settings, win: () => win,
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

  // ----- settings ----- (src/ipc-settings.js)
  registerSettingsIpc({
    applyPresenceSetting, catalog, discordAuth, findDotaGamePath, library, moveLangFolder,
    presence, refreshPresence, remoteConfig, settings, settingsView, validateGamePath,
    updater: () => updater,
    langFolder: () => langFolder,
    patchWatcher: () => patchWatcher,
    setPresenceView: (v) => { presenceView = v; },
    win: () => win,
  });

  // One gate, handed to both of the modules that guard a channel with it. Two copies is how
  // installing broke: the call went to one file and the helper stayed in the other.
  const blocked = createGate({ remoteConfig, settings });

  // ----- install/manage ----- (src/ipc-mods.js)
  registerModsIpc({
    applyMasterToCursors, blocked, catalog, diag, disableOtherCursors, fingerprints,
    importVpkBuffers, importVpkPaths, installer, isCursorRecord, library, refreshPresence,
    schemaService, sendProgress, win: () => win,
    // read late: Steam's verify rewrites this while the app is running
    verifyStuck: () => verifyStuck,
  });

  // ----- launch + master mods switch -----

  // Launch Dota via Steam so the user's own launch options apply (-novid, -fps max,
  // -language russian … differ per user). rungameid mirrors clicking Play in Steam.
  ipcMain.handle('game:launch', () => {
    // a Dota update wipes the search-path patch and moves the item table underneath our
    // build: the launch button is the last chance to notice before the game starts
    schemaService.heal();
    shell.openExternal('steam://rungameid/570');
    return { ok: true };
  });

  // ---------- item schema / search-path patch ----------

  // ----- what the app was told from the network ----- (src/ipc-game.js)
  registerGameIpc({
    blocked, diag, dotaIsRunning, gameIcons, icons, library, modPreviews, remoteConfig,
    repairAfterPatch, schemaService, settings, toolchain,
    patchRepair: () => patchRepair,
    setPatchRepair,
  });

  // ----- managing what is installed ----- (src/ipc-library.js)
  registerLibraryIpc({
    applyMasterToCursors, catalog, disableOtherCosmetics, disableOtherCursors, fingerprints,
    installer, isCursorRecord, library, refreshPresence, schemaService,
  });

  // ----- combined packs ----- (src/ipc-packs.js)
  registerPacksIpc({ afterDeployMaster, deployAndApply, installer, library });

  // ----- presets ----- (src/ipc-presets.js)
  registerPresetsIpc({
    win: () => win, settings, catalog, installer, library, schemaService, presets,
    adoptImportedFiles, afterDeployMaster, disableOtherCursors, sendProgress,
  });

  // ----- misc ----- (src/ipc-misc.js)
  registerMiscIpc({ installer, library });

  // ----- diagnostics ----- (src/ipc-diagnostics.js)
  registerDiagnosticsIpc({
    autoUpdater, catalog, diag, dotaIsRunning, icons, installer, library, logFile, remoteConfig,
    schemaService, settings, toolchain,
    win: () => win,
    rendererErrors: () => rendererErrors,
    lastUpdateError: () => (updater ? updater.lastError() : null),
  });
}

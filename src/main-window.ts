/* The one window the app has: its size on the screen it opens on, the single page it may show,
 * and the keys that scale its content.
 *
 * The window shows one page and never another. A preload script is attached to the webContents,
 * not to the document, so a page the window navigated to would inherit window.api: the whole IPC
 * surface, install and runTool included. Nothing in the app navigates anywhere, but the catalog's
 * own HTML lands in the interface (guides), and one <meta http-equiv="refresh"> in it would be
 * enough to hand that surface to whoever wrote the markup. CSP does not cover navigation, so this
 * does: the app's own file is the only thing the window may load, and a link that wants a browser
 * gets the browser.
 */
import path from 'node:path';

import { loadAppPage } from './app-page.ts';
import { electron } from './electron.ts';
import type { BrowserWindow } from 'electron';
import type { Settings } from './settings.ts';

/** The UI scale, kept inside a range where the layout still holds together. */
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.6;

/** A scale the layout can take: anything else, including nonsense, becomes the nearest one or 1. */
export function clampZoom(v: unknown): number {
  const z = Number(v);
  if (!Number.isFinite(z) || z <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** The size this is designed at, and the smallest it still works at. */
const DESIGNED = { width: 1360, height: 860, minWidth: 1020, minHeight: 640 };

/* The window has to fit the screen it opens on.
 *
 * 1360x860 is the size this is designed at, and on a 1366x768 laptop, still one of the most
 * common screens there is, a window 860 tall does not fit a work area about 730 tall. Windows
 * places it anyway and the bottom of it sits under the taskbar or past the edge of the screen,
 * where the launch bar and the last rows of a list are. Nothing is broken and nothing scrolls
 * wrong; the part of the window holding them is simply not on the screen, which reads exactly
 * like a page that stops scrolling partway. A restart does not help, because the size is asked
 * for again every time.
 *
 * Display scaling makes it worse rather than better: at 150% a 1080p screen reports a work area
 * around 1280x680, so a machine whose specification looks roomy has less room than the laptop.
 *
 * The minimums are clamped too. A minimum taller than the screen is not a floor, it is a
 * guarantee of the same overflow, and it takes away the one thing the person can do about it.
 */
/** The window's size and minimums for a work area, or the designed size when there is none. */
export function windowFit(workArea: { width: number; height: number } | null | undefined): typeof DESIGNED {
  const { width: aw, height: ah } = workArea || { width: 0, height: 0 };
  if (!(aw > 0 && ah > 0)) return { ...DESIGNED };
  return {
    width: Math.min(DESIGNED.width, aw),
    height: Math.min(DESIGNED.height, ah),
    minWidth: Math.min(DESIGNED.minWidth, aw),
    minHeight: Math.min(DESIGNED.minHeight, ah),
  };
}

/** A work area written "1366x728" (MM_WORKAREA, tools/sim profiles), standing in for a smaller screen. */
export function workAreaFrom(spec: string | undefined): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(spec || '');
  return m ? { width: +m[1], height: +m[2] } : null;
}

/** The key a Ctrl chord turns into a new scale, or null for any other key. */
export function zoomFor(key: string, current: number): number | null {
  if (key === '=' || key === '+') return clampZoom(current + 0.05);
  if (key === '-' || key === '_') return clampZoom(current - 0.05);
  if (key === '0') return 1;
  return null;
}

/**
 * Open the window on the app's page, locked to it, with Ctrl +/-/0 scaling the content.
 * @param appRoot    where out/renderer and preload.js are
 * @param workArea   stands in for the screen's (MM_WORKAREA); otherwise the primary display is asked
 * @param quiet      created hidden (MM_QUIET), so a measuring run never takes over the screen
 * @param pageExists stands in for the disk when a test asks whether the page was built
 */
export function createMainWindow({ appRoot, settings, diag, workArea = null, quiet = false, pageExists }: {
  appRoot: string;
  settings: Pick<Settings, 'get' | 'set'>;
  diag: (msg: string) => void;
  workArea?: { width: number; height: number } | null;
  quiet?: boolean;
  pageExists?: (p: string) => boolean;
}): BrowserWindow {
  const { app, BrowserWindow, dialog, screen, shell } = electron();
  let area = workArea;
  // no display info: better the designed size than no window at all
  if (!area) { try { area = screen.getPrimaryDisplay().workAreaSize; } catch { area = null; } }

  const win = new BrowserWindow({
    ...windowFit(area),
    backgroundColor: '#050506',
    autoHideMenuBar: true,
    frame: false,
    // A window that was never shown produces no frames, and a view transition waits for one:
    // time-from-click-to-visible reads in seconds then and means nothing. A quiet run measures
    // the main thread (the gap between timer ticks) instead, which is what a frozen window is.
    show: !quiet,
    webPreferences: {
      preload: path.join(appRoot, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // out/renderer, or the Vite server under `npm run dev` (src/app-page.ts)
  const appUrl = loadAppPage(win, { app, dialog, root: appRoot, exists: pageExists });
  // a checkout nobody built: the app is quitting, and there is no page to guard
  if (!appUrl) return win;

  const leavesForBrowser = (url: string) => {
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
  // preventDefault() at this point also swallows Electron's built-in zoom accelerators, which
  // zoom the whole window, panels included, and that is exactly what is not wanted.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt) return;
    const z = zoomFor(input.key, clampZoom(settings.get('uiScale')));
    if (z === null) return;
    event.preventDefault();
    settings.set('uiScale', z);
    win.webContents.send('ui:zoom', z); // the renderer owns the scale itself
  });

  return win;
}

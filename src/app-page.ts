/* The page the main window loads.
 *
 * Normally the one Vite builds into out/renderer (vite.config.mjs). An unpackaged run under
 * `npm run dev` loads it from the Vite server on this machine instead, so an edit shows without
 * a restart. A packaged app ignores MM_DEV_URL whatever it says: the variable would otherwise be
 * a way to hand window.api to any page at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { App, BrowserWindow, Dialog } from 'electron';

/** The only address `npm run dev` serves from (tools/dev.mjs, vite.config.mjs). */
export const LOCAL_DEV_URL = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/;

type Exists = (p: string) => boolean;

/** Where the window's page is, and whether there is one. */
export function appPage({ root, isPackaged, devUrl, exists = fs.existsSync }: {
  root: string; isPackaged: boolean; devUrl?: string; exists?: Exists;
}): { kind: 'url' | 'file' | 'missing'; page: string; url: string } {
  const page = path.join(root, 'out', 'renderer', 'index.html');
  if (!isPackaged && LOCAL_DEV_URL.test(devUrl || '')) return { kind: 'url', page, url: String(devUrl) };
  return { kind: exists(page) ? 'file' : 'missing', page, url: pathToFileURL(page).href };
}

/**
 * Loads the page into the window and returns its address, the one the navigation guard lets
 * through, or null when a checkout was never built (an installer always carries the page).
 */
export function loadAppPage(win: Pick<BrowserWindow, 'loadURL' | 'loadFile'>, { app, dialog, root, env = process.env, exists }: {
  app: Pick<App, 'isPackaged' | 'quit'>;
  dialog: Pick<Dialog, 'showErrorBox'>;
  root: string;
  env?: NodeJS.ProcessEnv;
  exists?: Exists;
}): string | null {
  const where = appPage({ root, isPackaged: app.isPackaged, devUrl: env.MM_DEV_URL, exists });
  if (where.kind === 'missing') {
    dialog.showErrorBox('Dota 2 Mod Manager', 'The interface is not built. Run: npm run build:ui');
    app.quit();
    return null;
  }
  if (where.kind === 'url') win.loadURL(where.url);
  else win.loadFile(where.page);
  return where.url;
}

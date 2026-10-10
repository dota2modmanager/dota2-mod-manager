/* Who may call the main process, and with what.
 *
 * The window's page reaches the main process through window.api (preload.js), and every channel
 * behind it trusted whoever called: any frame, any page, any arguments. The page is the app's own
 * and navigation off it is blocked (src/main-window.ts), but it also draws text from outside - mod
 * names and descriptions from the catalog, preset notes from a friend - and the day one of those
 * gets a script past the page, that script holds the same window.api the buttons do. Electron's
 * security checklist asks for the sender of every message to be checked for that reason
 * (https://www.electronjs.org/docs/latest/tutorial/security, "Validate the sender of all IPC
 * messages").
 *
 * So the checks go in front of every channel, in one place: ipcMain.handle and ipcMain.on are
 * wrapped before anything registers. A call is answered only when it comes from the top frame of
 * one of the app's own pages - the main window's, or the removal window's - and its arguments fit
 * the channel's entry in src/channel-args.ts. Registering a channel with no entry there throws at
 * start, so a new channel cannot ship unchecked. Refusals go to the diagnostics log.
 *
 * The same guard answers the browser's permission questions (the clipboard for a share link and
 * fullscreen for the video player, nothing else, and only for the app's pages) and locks every
 * web contents the app ever creates: no webview, no window.open, no navigation off the app's pages.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { App, IpcMain, IpcMainEvent, IpcMainInvokeEvent, Session, WebContents } from 'electron';

import { appPage } from './app-page.ts';
import { CHANNEL_ARGS, checkArgs } from './channel-args.ts';

/** The part of an IPC event the guard reads. */
type Sender = { senderFrame?: { url: string; parent: unknown } | null };
type Listener = (...a: unknown[]) => unknown;

/** What the app's pages may ask the browser for: the share link's copy, and the player's fullscreen. */
const PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

/** An address reduced to the page it names: no query, no fragment, and a file path as Windows compares it. */
export function pageKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') {
      const p = path.resolve(fileURLToPath(u));
      return `file:${process.platform === 'win32' ? p.toLowerCase() : p}`;
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') return `${u.protocol}//${u.host}${u.pathname}`;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param pages  the addresses of the app's own pages: what the main window loads and the removal window's
 * @param log    the diagnostics log, told about every refusal
 */
export function createIpcGuard({ pages, log }: { pages: string[]; log: (msg: string) => void }) {
  const ours = new Set(pages.map(pageKey).filter((k): k is string => !!k));

  const isAppPage = (url: string | null | undefined): boolean => {
    const key = pageKey(String(url || ''));
    return !!key && ours.has(key);
  };

  /** Why this sender may not call, or null when it may. */
  const refuse = (e: Sender): string | null => {
    const frame = e.senderFrame;
    if (!frame) return 'a frame that is gone';
    if (frame.parent) return 'a frame inside the page';
    if (!isAppPage(frame.url)) return `a page that is not the app's: ${String(frame.url).slice(0, 160)}`;
    return null;
  };

  /** Why this call may not go through, or null when it may. */
  const vet = (channel: string, e: Sender, args: unknown[]): string | null => refuse(e) || checkArgs(channel, args);

  /** Put the checks in front of every channel registered on `ipcMain` from now on. */
  const install = (ipcMain: Pick<IpcMain, 'handle' | 'on'>): void => {
    const handle = ipcMain.handle.bind(ipcMain);
    const on = ipcMain.on.bind(ipcMain);
    const known = (channel: string) => {
      if (!Object.hasOwn(CHANNEL_ARGS, channel)) throw new Error(`ipc: ${channel} has no argument check in src/channel-args.ts`);
    };
    ipcMain.handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: never[]) => unknown) => {
      known(channel);
      handle(channel, (e: IpcMainInvokeEvent, ...args: unknown[]) => {
        const why = vet(channel, e, args);
        if (why) {
          log(`ipc: refused ${channel}: ${why}`);
          throw new Error(`refused: ${why}`);
        }
        return (fn as Listener)(e, ...args);
      });
    };
    ipcMain.on = ((channel: string, fn: (e: IpcMainEvent, ...args: never[]) => void) => {
      known(channel);
      return on(channel, (e: IpcMainEvent, ...args: unknown[]) => {
        const why = vet(channel, e, args);
        if (why) { log(`ipc: refused ${channel}: ${why}`); return; }
        (fn as Listener)(e, ...args);
      });
    }) as IpcMain['on'];
  };

  /** Answer the browser's permission questions: two permissions, for the app's pages only. */
  const permissions = (session: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>): void => {
    session.setPermissionRequestHandler((wc, permission, callback, details) => {
      const ok = PERMISSIONS.has(permission) && isAppPage(details?.requestingUrl || wc?.getURL());
      if (!ok) log(`permission refused: ${permission}`);
      callback(ok);
    });
    session.setPermissionCheckHandler((wc, permission, _origin, details) =>
      PERMISSIONS.has(permission) && isAppPage(details?.requestingUrl || wc?.getURL()));
  };

  /** Lock a web contents the moment it exists: no webview, no new windows, no page but the app's. */
  const lock = (contents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>): void => {
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.on('will-navigate', (e, url) => {
      if (!isAppPage(url)) e.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  };

  return { isAppPage, refuse, vet, install, permissions, lock };
}

/** The two pages of this app: what the main window loads (src/app-page.ts) and the removal window's. */
export function appPages({ appRoot, isPackaged, devUrl }: { appRoot: string; isPackaged: boolean; devUrl?: string }): string[] {
  return [
    appPage({ root: appRoot, isPackaged, devUrl }).url,
    pathToFileURL(path.join(appRoot, 'renderer', 'uninstall.html')).href,
  ];
}

/**
 * The whole guard, as src/main.ts puts it up before any channel or window exists: the channels,
 * the browser's permissions, and every web contents locked the moment it is created.
 */
export function guardTheApp({ app, ipcMain, session, appRoot, devUrl, log }: {
  app: Pick<App, 'isPackaged' | 'on'>;
  ipcMain: Pick<IpcMain, 'handle' | 'on'>;
  session: { defaultSession: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'> };
  appRoot: string;
  devUrl?: string;
  log: (msg: string) => void;
}): ReturnType<typeof createIpcGuard> {
  const guard = createIpcGuard({ pages: appPages({ appRoot, isPackaged: app.isPackaged, devUrl }), log });
  guard.install(ipcMain);
  guard.permissions(session.defaultSession);
  app.on('web-contents-created', (_e, contents) => guard.lock(contents));
  return guard;
}

/* The tray icon and the sign-in entry over Electron, for src/tray.ts, which holds the logic. */
import path from 'node:path';
import { electron } from './electron.ts';
import { t } from './i18n.ts';
import { jailRoots } from './write-jail.ts';
import { inBackground, keepInTray, setLoginItem } from './tray.ts';
import type { Settings } from './settings.ts';
import type { BrowserWindow } from 'electron';

/**
 * Keep the window in the tray and register the app with Windows, as the setting says.
 * @returns what Settings calls after the switch moves or the language changes
 */
export function startBackground({ win, settings, appRoot, portable, play, diag }: {
  win: BrowserWindow; settings: Pick<Settings, 'get' | 'set'>; appRoot: string; portable: boolean; play: () => void; diag: (msg: string) => void;
}): () => void {
  const { app, Tray, Menu, nativeImage } = electron();
  const icon = () => nativeImage.createFromPath(path.join(appRoot, 'build', 'icon.png')).resize({ width: 16, height: 16 });
  const tray = keepInTray({
    app, win, settings, t, play, diag,
    makeTray: () => new Tray(icon()),
    menu: (items) => Menu.buildFromTemplate(items),
  });
  // only an installed Windows build: a portable copy runs from a temp folder that is gone after it
  // exits, and a dev run or a sandbox must not put itself in front of the user's next sign-in
  const allowed = process.platform === 'win32' && app.isPackaged && !portable && !jailRoots().length;
  const apply = () => {
    tray.sync();
    try { setLoginItem(app, inBackground(settings), { allowed }); } catch (err) { diag(`login item not set: ${(err as Error).message}`); }
  };
  apply();
  return apply;
}

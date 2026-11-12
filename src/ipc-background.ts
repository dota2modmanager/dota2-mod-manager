/* The channels of the window for the main menu's background of the user's own (issue #418): what
 * is on now, and a movie put on with its dimming and blur. The window turns the user's picture,
 * GIF or video into a WebM itself (renderer/catalog/background/encode.ts); the pak is made in
 * src/menu-background-service.ts out of the game's own layouts, in a few milliseconds. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerBackgroundIpc({ menuBackground, afterDeployMaster, blocked }: Pick<AppContext, 'menuBackground' | 'afterDeployMaster' | 'blocked'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('background:state', () => {
    try { return { ok: true, ...menuBackground.state() }; } catch (err) { return { error: errorText(err) }; }
  });
  ipcMain.handle('background:install', (e, webm, source, dim, blur) => {
    const stop = blocked('install');
    if (stop) return stop;
    try {
      const record = menuBackground.install(webm ? new Uint8Array(webm) : null, source, dim, blur);
      afterDeployMaster();
      return { ok: true, record };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

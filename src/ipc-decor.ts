/* The channels of the window for the map without its decor: what is off the map now and how much
 * each group takes on this map, and the groups taken off. The thinking is in src/map-decor.ts; a
 * build reads the map and copies one of the game's materials, no tools. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerDecorIpc({ mapDecor, afterDeployMaster, blocked }: Pick<AppContext, 'mapDecor' | 'afterDeployMaster' | 'blocked'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('decor:state', async () => {
    try { return { ok: true, ...(await mapDecor.state()) }; } catch (err) { return { error: errorText(err) }; }
  });
  ipcMain.handle('decor:install', async (e, groups) => {
    const stop = blocked('install');
    if (stop) return stop;
    try {
      const record = await mapDecor.install(groups);
      afterDeployMaster();
      return { ok: true, record };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

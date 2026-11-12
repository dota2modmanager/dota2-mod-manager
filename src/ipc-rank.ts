/* The channels of the window for the rank medal and hero levels of the player's own screen: what
 * is on now and the heroes of this patch, the medal and badge pictures out of the game, and a look
 * put on. The thinking is in src/rank-look-service.ts; a build writes two styles and the levels
 * script itself (src/panorama-files.ts), without Valve's compiler. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerRankIpc({ rankLook, afterDeployMaster, blocked }: Pick<AppContext, 'rankLook' | 'afterDeployMaster' | 'blocked'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('rank:state', () => {
    try { return { ok: true, ...rankLook.state() }; } catch (err) { return { error: errorText(err) }; }
  });
  ipcMain.handle('rank:pictures', async () => {
    try { return { ok: true, ...(await rankLook.pictures()) }; } catch (err) { return { error: errorText(err) }; }
  });
  ipcMain.handle('rank:install', async (e, look) => {
    const stop = blocked('install');
    if (stop) return stop;
    try {
      const record = await rankLook.install(look);
      afterDeployMaster();
      return { ok: true, record };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

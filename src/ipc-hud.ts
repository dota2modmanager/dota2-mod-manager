/* The channels of the window for the in-game HUD made smaller or larger (issue #420): the scale
 * on now and whether ValveResourceFormat is there, and a scale put on. The thinking is in
 * src/hud-scale-service.ts; a build reads the style back with ValveResourceFormat and compiles it
 * with Valve's resourcecompiler, a second or two, each in its own process. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerHudIpc({ hudScale, afterDeployMaster, blocked }: Pick<AppContext, 'hudScale' | 'afterDeployMaster' | 'blocked'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('hud:state', () => {
    try { return { ok: true, ...hudScale.state() }; } catch (err) { return { error: errorText(err) }; }
  });
  ipcMain.handle('hud:install', async (e, scale) => {
    const stop = blocked('install');
    if (stop) return stop;
    try {
      const record = await hudScale.install(scale);
      afterDeployMaster();
      return { ok: true, record };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

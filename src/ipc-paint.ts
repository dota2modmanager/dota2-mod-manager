/* The channels of the window for a hero recoloured part by part (issue #422): the hero's layers with
 * the colours on now, and the hero put on in a colour per layer. The pak is built from the game's
 * own pak01 a step at a time (src/hero-paint-service.ts), so the window stays drawn meanwhile. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerPaintIpc({ heroPaint, afterDeployMaster, blocked }: Pick<AppContext, 'heroPaint' | 'afterDeployMaster' | 'blocked'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('paint:state', (e, hero) => {
    try { return { ok: true, ...heroPaint.state(hero) }; } catch (err) { return { error: errorText(err) }; }
  });
  ipcMain.handle('paint:install', async (e, hero, colors, label) => {
    const stop = blocked('install');
    if (stop) return stop;
    try {
      const record = await heroPaint.install(hero, colors, label);
      afterDeployMaster();
      return { ok: true, record };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

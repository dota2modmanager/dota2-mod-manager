/* The channels of the window for a hero recoloured part by part (issue #422): the hero's layers with
 * the colours on now, the abilities' icons to show them on, and the hero put on in a colour per layer. The pak is built from the game's
 * own pak01 a step at a time (src/hero-paint-service.ts), so the window stays drawn meanwhile. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerPaintIpc({ heroPaint, gameIcons, afterDeployMaster, blocked }: Pick<AppContext, 'heroPaint' | 'gameIcons' | 'afterDeployMaster' | 'blocked'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('paint:state', (e, hero, items) => {
    try { return { ok: true, ...heroPaint.state(hero, items) }; } catch (err) { return { error: errorText(err) }; }
  });
  // the abilities' icons, the pictures the window shows each colour on
  ipcMain.handle('paint:icons', async (e, abilities) => {
    try { return await gameIcons.abilityIcons(abilities); } catch { return {}; }
  });
  ipcMain.handle('paint:install', async (e, hero, colors, label, items) => {
    const stop = blocked('install');
    if (stop) return stop;
    try {
      const record = await heroPaint.install(hero, colors, label, items);
      afterDeployMaster();
      return { ok: true, record };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

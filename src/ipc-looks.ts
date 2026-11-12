/* The channel of the item builder's saved looks (issue #527): a look the window keeps in the
 * settings put on in one write. The picks and what goes off are src/schema-cosmetics.ts wearLook. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerLooksIpc({ schemaService, blocked }: Pick<AppContext, 'schemaService' | 'blocked'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('cosmetics:wearLook', async (e, hero, picks) => {
    const stop = blocked('cosmetics');
    if (stop) return stop;
    try {
      const worn = schemaService.wearLook(hero, picks, { write: false });
      await schemaService.refreshInBackground();
      return { ok: true, ...worn };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

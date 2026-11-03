/* Hero grids for the pick screen out of this patch's numbers (src/hero-grid.ts, issue #428).
 *
 * The file is the account's, in Steam's folder rather than the game's, and Dota writes it back
 * when it closes: a grid written while the game runs would be gone the moment it exits. So the
 * write waits for a closed game, like every write to the game folder does.
 */
import path from 'node:path';

import { t } from './i18n.ts';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import { createHeroGrids, GRID_KINDS, type GridKind } from './hero-grid.ts';
import { steamAccountDir } from './gamelang.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services and callbacks src/main.ts hands it. */
export function registerGridIpc({ settings, dotaIsRunning }: Pick<AppContext, 'settings' | 'dotaIsRunning'>): void {
  const { ipcMain, app } = electron();
  const grids = createHeroGrids({
    dataDir: path.join(app.getPath('userData'), 'hero-grid'),
    accountDir: () => steamAccountDir(settings.get('dotaGamePath')),
  });

  ipcMain.handle('grid:state', () => grids.state());
  ipcMain.handle('grid:apply', async (e, kinds) => {
    if (await dotaIsRunning()) return { error: t('Закрой Dota 2: при выходе она перепишет файл сеток') };
    try {
      return { ok: true, ...(await grids.apply((kinds as string[]).filter((k): k is GridKind => (GRID_KINDS as readonly string[]).includes(k)))) };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
  ipcMain.handle('grid:remove', async () => {
    if (await dotaIsRunning()) return { error: t('Закрой Dota 2: при выходе она перепишет файл сеток') };
    try {
      return { ok: true, ...grids.remove() };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

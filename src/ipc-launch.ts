/* Play. Launches Dota through Steam so the user's own launch options apply (-novid, -fps max,
 * -language russian all differ per user): rungameid is what pressing Play in Steam does. */
import { electron } from './electron.ts';
import { launchWarning } from './steam-appstate.ts';
import type { AppContext } from './app-context.ts';

/** Register game:launch. */
export function registerLaunchIpc({ schemaService, settings, gameLaunched }: Pick<AppContext, 'schemaService' | 'settings' | 'gameLaunched'>): void {
  const { ipcMain, shell } = electron();
  ipcMain.handle('game:launch', async () => {
    // an item table still being built (a pick a moment ago, a base just come) goes in first
    await schemaService.settled();
    // a Dota update wipes the search-path patch and moves the item table underneath our build:
    // the launch button is the last chance to notice before the game starts
    schemaService.heal();
    // a close seconds from now is a crash worth naming (src/crash-watch.ts)
    gameLaunched();
    void shell.openExternal('steam://rungameid/570');
    return { ok: true, warning: launchWarning(settings.get('dotaGamePath')) };
  });
}

/* The channels of the window for a hero's ability icons picked from his own cosmetics' (the
 * thinking is src/ability-icons-service.ts): the heroes there is a choice for, one hero's abilities
 * with their icons, the pictures to draw them with, and an icon put on or taken off. A pick is a copy
 * of a few of the game's files, so it is built here, at once, with no compiler. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerIconsIpc({ abilityIcons, gameIcons, afterDeployMaster, blocked }: Pick<AppContext, 'abilityIcons' | 'gameIcons' | 'afterDeployMaster' | 'blocked'>): void {
  const { ipcMain } = electron();
  const answer = async <T>(fn: () => T | Promise<T>) => {
    try { return { ok: true as const, ...(await fn()) }; } catch (err) { return { error: errorText(err) }; }
  };
  ipcMain.handle('icons:heroes', () => answer(() => ({ heroes: abilityIcons.heroes() })));
  ipcMain.handle('icons:hero', (e, hero) => answer(() => abilityIcons.hero(hero)));
  // the game's own pictures as PNG; a picture that cannot be read without the toolchain is left out
  ipcMain.handle('icons:pictures', async (e, icons) => {
    try { return await gameIcons.abilityIcons(icons); } catch { return {}; }
  });
  ipcMain.handle('icons:set', (e, hero, ability, icon) => {
    const stop = blocked('install');
    if (stop) return stop;
    return answer(() => {
      const record = abilityIcons.set(hero, ability, icon ?? null);
      afterDeployMaster();
      return { record };
    });
  });
  ipcMain.handle('icons:clear', (e, hero) => answer(() => {
    const record = abilityIcons.clear(hero);
    afterDeployMaster();
    return { record };
  }));
}

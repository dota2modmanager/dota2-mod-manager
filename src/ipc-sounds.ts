/* The channels of the window for a sound of the user's own on a hero's event (issue #423): the
 * heroes, one hero's events and the sounds on them, a sound put on and one taken off. The thinking
 * is in src/ability-sounds-service.ts; a build compiles with Valve's resourcecompiler, so it takes
 * a second or two and runs in the compiler's own process, not in this one. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerSoundsIpc({ abilitySounds, afterDeployMaster, blocked }: Pick<AppContext, 'abilitySounds' | 'afterDeployMaster' | 'blocked'>): void {
  const { ipcMain } = electron();
  const answer = async <T>(fn: () => T | Promise<T>) => {
    try { return { ok: true as const, ...(await fn()) }; } catch (err) { return { error: errorText(err) }; }
  };
  ipcMain.handle('sounds:heroes', () => answer(() => ({ heroes: abilitySounds.heroes() })));
  ipcMain.handle('sounds:hero', (e, hero) => answer(() => abilitySounds.hero(hero)));
  ipcMain.handle('sounds:add', (e, hero, event, mode, volume, wav, label) => {
    const stop = blocked('install');
    if (stop) return stop;
    return answer(async () => {
      const record = await abilitySounds.add(hero, event, mode, volume, Buffer.from(wav), label || '');
      afterDeployMaster();
      return { record };
    });
  });
  ipcMain.handle('sounds:remove', (e, hero, event) => answer(async () => ({ record: await abilitySounds.remove(hero, event) })));
}

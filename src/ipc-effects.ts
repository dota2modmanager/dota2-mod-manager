/* The channels of the effect editor: finding an effect, how it plays with changes on, and the
 * change put in My mods. The thinking is in src/effect-edit-service.ts. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerEffectsIpc({ effectEdit, afterDeployMaster, blocked }: Pick<AppContext, 'effectEdit' | 'afterDeployMaster' | 'blocked'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('fx:search', (e, query) => {
    try { return { ok: true, paths: effectEdit.search(query), saved: effectEdit.saved() }; } catch (err) { return { error: errorText(err) }; }
  });
  ipcMain.handle('fx:load', async (e, path) => {
    try { return { ok: true, ...(await effectEdit.load(path)) }; } catch (err) { return { error: errorText(err) }; }
  });
  ipcMain.handle('fx:preview', (e, path, edits) => {
    try { return { ok: true, def: effectEdit.preview(path, edits) }; } catch (err) { return { error: errorText(err) }; }
  });
  ipcMain.handle('fx:install', (e, path, edits) => {
    const stop = blocked('install');
    if (stop) return stop;
    try {
      const record = effectEdit.install(path, edits);
      afterDeployMaster();
      return { ok: true, record };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

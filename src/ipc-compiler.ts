/* resourcecompiler.exe as Settings shows it: whether there is one, picking another, and making the
 * Wine prefix it runs in on Linux (src/resource-compiler.ts, src/wine.ts).
 *
 * The path of the program the app will run is never taken from the window. It comes out of a
 * dialog the main process opens, and is kept only when it is a compiler where the Workshop Tools
 * put one, so a script in the page cannot name a program for the app to start.
 */
import { t } from './i18n.ts';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import { installOf } from './resource-compiler.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services and callbacks src/main.ts hands it. */
export function registerCompilerIpc({ compiler, diag, settings, win }: Pick<AppContext, 'compiler' | 'diag' | 'settings' | 'win'>): void {
  const { dialog, ipcMain } = electron();

  ipcMain.handle('compiler:state', () => compiler.state());

  ipcMain.handle('compiler:browse', async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: t('Выбери resourcecompiler.exe в папке game/bin/win64 игры с Workshop Tools'),
      properties: ['openFile'],
      filters: [{ name: 'resourcecompiler.exe', extensions: ['exe'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const exe = res.filePaths[0];
    if (!installOf(exe)) return { error: t('Это не resourcecompiler.exe из папки game/bin/win64 установленной Dota 2') };
    settings.set('resourceCompilerPath', exe);
    diag(`compiler: picked ${exe}`);
    return { ok: true, state: compiler.state() };
  });

  ipcMain.handle('compiler:forget', () => {
    settings.set('resourceCompilerPath', null);
    return { ok: true, state: compiler.state() };
  });

  // the prefix is made by the first compile anyway; this is for doing it while somebody watches
  ipcMain.handle('compiler:prepare', async () => {
    try {
      await compiler.prepare();
      return { ok: true, state: compiler.state() };
    } catch (err) {
      diag(`compiler: not ready: ${errorText(err)}`);
      return { error: errorText(err), state: compiler.state() };
    }
  });
}

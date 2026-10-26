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
export function registerCompilerIpc({ compiler, diag, keepTools, sendProgress, settings, toolsKeeper, win }: Pick<AppContext, 'compiler' | 'diag' | 'keepTools' | 'sendProgress' | 'settings' | 'toolsKeeper' | 'win'>): void {
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

  /* The empty model compiled, its steps counted on the bar at the bottom: making the prefix is a few
   * seconds the first time, and the compile five more, which is long enough to look stuck. */
  ipcMain.handle('compiler:check', async () => {
    const label = t('Проверка компилятора');
    const steps = compiler.state().needsWine ? ['wine', 'compile'] : ['compile'];
    sendProgress({ type: 'count', label, done: 0, total: steps.length });
    const result = await compiler.check((step) => sendProgress({
      type: 'count', label: `${label}: ${step === 'wine' ? t('подготовка Wine') : t('сборка пустой модели')}`, done: steps.indexOf(step), total: steps.length,
    }));
    sendProgress(result.ok ? { type: 'done', label } : { type: 'error', label, message: result.message || '' });
    // tools that work are worth keeping for when Steam takes them away (src/workshop-tools.ts)
    if (result.ok && compiler.state().source === 'game') keepTools().catch(() => {});
    return result.ok ? { ok: true, state: compiler.state() } : { error: result.message, state: compiler.state() };
  });

  // the copy made on the user's word: again even if they deleted the one of these same tools
  ipcMain.handle('compiler:keep', async () => {
    try {
      await keepTools({ force: true });
      return { ok: true, state: compiler.state() };
    } catch (err) {
      return { error: errorText(err), state: compiler.state() };
    }
  });

  ipcMain.handle('compiler:removeKept', () => {
    toolsKeeper?.remove();
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

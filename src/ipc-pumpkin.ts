/* The pumpkin's key and its prize (src/pumpkin.ts), for renderer/ui/pumpkin.ts. */
import { electron } from './electron.ts';
import { createPumpkin } from './pumpkin.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services and callbacks src/main.ts hands it. */
export function registerPumpkinIpc({
  settings, importVpkPaths, library, diag,
}: Pick<AppContext, 'settings' | 'importVpkPaths' | 'library' | 'diag'>): void {
  const { ipcMain } = electron();
  const pumpkin = createPumpkin({
    settings: { get: (k) => settings.get(k as never), set: (k, v) => settings.set(k as never, v as never) },
    importVpkPaths: (paths) => importVpkPaths(paths),
    library,
    log: diag,
  });
  ipcMain.handle('pumpkin:redeem', (e, typed) => pumpkin.redeem(typeof typed === 'string' ? typed.slice(0, 80) : ''));
  ipcMain.handle('pumpkin:prizeAgain', () => pumpkin.prizeAgain());
  ipcMain.handle('pumpkin:hasPrize', () => pumpkin.hasPrize());
}

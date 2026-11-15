/* The Optimization window's channels. They are Rust's alone (crates/mm-core/src/looks/map_decor.rs,
 * map_optimize.rs, owner_preview3d.rs): the Node host registers them so the window's calls have a
 * handler here too, and answers as a game with nothing to offer: no map read, nothing to build. */
import { electron } from './electron.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels: an install still answers to the guard while Dota runs. */
export function registerDecorIpc({ blocked }: Pick<AppContext, 'blocked'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('decor:state', () => ({ ok: true, installed: null, map: null, counts: null, samples: null }));
  ipcMain.handle('decor:install', () => blocked('install') ?? { ok: false });
  ipcMain.handle('decor:scene', () => ({ ready: false, tool: false }));
  ipcMain.handle('decor:map', () => null);
  ipcMain.handle('decor:ground', () => null);
  ipcMain.handle('decor:modTrees', () => null);
  ipcMain.handle('decor:paint', () => null);
  ipcMain.handle('decor:modModel', () => null);
}

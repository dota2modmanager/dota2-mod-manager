/* Every IPC module, registered in one place over the context src/main.ts builds. A new
 * src/ipc-*.ts module is imported and called here; test/ipc-contract.test.js fails until it is.
 */
import type { AppContext } from './app-context.ts';
import { registerPresetsIpc } from './ipc-presets.ts';
import { registerModsIpc } from './ipc-mods.ts';
import { registerLibraryIpc } from './ipc-library.ts';
import { registerForeignIpc } from './ipc-foreign.ts';
import { registerPacksIpc } from './ipc-packs.ts';
import { registerWindowIpc } from './ipc-window.ts';
import { registerMiscIpc } from './ipc-misc.ts';
import { registerSettingsIpc } from './ipc-settings.ts';
import { registerGameIpc } from './ipc-game.ts';
import { registerDiagnosticsIpc } from './ipc-diagnostics.ts';

/** Register every channel the window can call. */
export function registerIpc(ctx: AppContext): void {
  registerWindowIpc(ctx);
  registerSettingsIpc(ctx);
  registerModsIpc(ctx);
  registerGameIpc(ctx);
  registerLibraryIpc(ctx);
  registerForeignIpc(ctx);
  registerPacksIpc(ctx);
  registerPresetsIpc(ctx);
  registerMiscIpc(ctx);
  registerDiagnosticsIpc(ctx);
}

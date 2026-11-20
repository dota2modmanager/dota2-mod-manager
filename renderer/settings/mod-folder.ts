/* The mods folder kept in Settings (crates/mm-core/src/app/settings.rs langFolderLock), written and moved into at once
 * by the main process (crates/mm-core/src/owner/owner_settings.rs). Apart from the row that draws it, so the window's one
 * list of the settings it writes (test/window-guard.test.ts) reads it. */
import { state } from '../core/store.ts';

/** The folder to keep the mods in, or null to have them follow the game again. */
export async function keepModsIn(folder: string | null): Promise<void> {
  state.settings = await window.api.settings.set('langFolderLock', folder);
}

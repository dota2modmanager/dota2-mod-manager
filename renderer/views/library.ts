/* My mods: what is installed, and in the order the game loads it.
 *
 * This file reads what the screen shows out of main and hands it to React (library/). Its parts
 * live beside it in views/library/: the state (state.ts), the model (build.ts, rows.ts), what the
 * screen can ask for (actions.ts), what a row's menu does (record-actions.ts), the foreign files
 * (external.ts) and imports (import.ts). */
import { state } from '../core/store.js';
import { registerView } from '../core/router.js';
import { applyInstalled, refreshInstalledIndex } from '../core/installed.js';
import { refreshPatchState, paintMasterSwitch } from '../ui/statusbar.js';
import { paint } from '../ui/transitions.js';
import { refreshNotices } from '../ui/notice.js';
import { loadOrder } from '../library/order.ts';
import { pruneSelection } from '../library/selection.ts';
import type { LibRecord } from '../library/types.ts';
import { showLibrary } from '../library/root.tsx';
import { actions } from './library/actions.ts';
import { libraryModel } from './library/build.ts';
import { lib, screen } from './library/state.ts';

export { handleImportResult } from './library/import.ts';

// a visit to the screen draws it fresh, the rows' entrance and all (router.js asks only when stale)
registerView('library', () => renderLibrary(true));

/** Read the mods, the folder and the patch state from main again, and draw. */
async function renderLibrary(fresh = false): Promise<void> {
  const res = await window.api.mods.list();
  // re-read rather than trust the boot copy: the banners over the list are about the folder on
  // disk right now, and a mod can go missing between two visits to this screen
  state.settings = await window.api.settings.get();
  lib.stuck = res.verifyStuck || [];
  try { lib.repair = await window.api.patch.repairState(); } catch { lib.repair = { state: 'idle' }; }
  await refreshNotices();
  // A tool is not a mod: it sits in the app's own folder and the game never mounts it. Its card in
  // the catalog says everything, so it is not listed here; the index below still gets the full
  // list, which is what tells the card it is already downloaded.
  lib.records = (res.installed as LibRecord[]).filter((r) => r.categoryId !== 'tools');
  lib.order = loadOrder(lib.records);
  lib.external = res.external || [];
  lib.slots = res.slots || 0;
  lib.slotCeil = res.slotCeil || 98;
  applyInstalled(res.installed); // the tab's counter and the catalog's badges follow the folder
  try { const ms = await window.api.mods.masterState(); state.masterOff = !!ms.off; } catch { state.masterOff = false; }
  paintMasterSwitch();
  await refreshPatchState(); // the schema conflicts and foreign-patcher banners
  pruneSelection(lib.sel, lib.records);
  if (fresh) lib.key++;
  await paint(draw);
}

function draw(): void {
  // the rows of a drop are already where they end up (library/drag.ts): that draw moves nothing
  if (lib.still) lib.still = false;
  else lib.motion++;
  showLibrary(libraryModel(), actions);
  lib.moved = '';
}

screen.draw = draw;
screen.reload = async () => {
  await refreshInstalledIndex();
  await renderLibrary();
};

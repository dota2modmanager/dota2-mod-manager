/* The channels of the 3D preview in the item builder's hero window (issue #417): the hero's body
 * and each slot's model as GLB bytes, and an effect's particle system for its picture. The thinking is in src/hero-preview.ts; the export runs in
 * the toolchain's own process (src/model-glb.ts), one at a time, and is kept per game build. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import { createLargeAnswers } from './large-answer.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerPreview3dIpc({ heroPreview, toolchain, diag }: Pick<AppContext, 'heroPreview' | 'toolchain' | 'diag'>): void {
  const { ipcMain } = electron();
  const large = createLargeAnswers();
  // the pieces of an answer too big for one message, which preload.js fetches (src/large-answer.ts)
  ipcMain.handle('preview3d:slice', (e, id, offset) => large.slice(id, offset));
  ipcMain.handle('preview3d:models', async (e, hero, slots) => {
    try {
      return large.pack(await heroPreview.models(hero, slots, !!toolchain.pathOf('vrf')));
    } catch (err) {
      // the window says only that the model could not be had; the reason goes to the log
      diag(`preview 3d: ${errorText(err)}`);
      return { ok: false, reason: 'no-body', error: errorText(err) };
    }
  });
  // every clip of a body, the first time the window is asked for one beyond the loadout
  ipcMain.handle('preview3d:motions', async (e, body) => {
    if (!toolchain.pathOf('vrf')) return null;
    try { return large.pack(await heroPreview.motions(body)); } catch (err) { diag(`preview 3d motions: ${errorText(err)}`); return null; }
  });
  // an effect's particle system, which the window draws as the effect's picture
  ipcMain.handle('preview3d:effect', async (e, id) => {
    try { return large.pack(await heroPreview.effect(id)); } catch (err) { diag(`preview 3d effect: ${errorText(err)}`); return null; }
  });
  // a map prop's model alone (a tree set's), which the window draws as its picture
  ipcMain.handle('preview3d:model', async (e, file) => {
    if (!toolchain.pathOf('vrf')) return null;
    try { return large.pack(await heroPreview.model(file)); } catch (err) { diag(`preview 3d model: ${errorText(err)}`); return null; }
  });
}

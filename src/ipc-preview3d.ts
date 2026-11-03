/* The channel of the 3D preview in the item builder's hero window (issue #417): the hero's body
 * and each slot's model as GLB bytes. The thinking is in src/hero-preview.ts; the export runs in
 * the toolchain's own process (src/model-glb.ts), one at a time, and is kept per game build. */
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerPreview3dIpc({ heroPreview, toolchain }: Pick<AppContext, 'heroPreview' | 'toolchain'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('preview3d:models', async (e, hero, slots) => {
    try {
      return await heroPreview.models(hero, slots, !!toolchain.pathOf('vrf'));
    } catch (err) {
      return { ok: false, reason: 'no-body', error: errorText(err) };
    }
  });
}

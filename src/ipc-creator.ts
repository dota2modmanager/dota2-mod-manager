/* The channels of the author's drafts (issue #236, step 1): the drafts, one saved, a style's VPK or
 * picture picked, one deleted, and one written out as an archive for the catalog's maintainer. The
 * thinking is in src/creator.ts; this asks the user for the files and where to save. */
import fs from 'node:fs';
import path from 'node:path';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import { t } from './i18n.ts';
import { createCreator, type Creator, type Draft } from './creator.ts';
import type { AppContext } from './app-context.ts';

// a picture is shown in the form as a data URL, up to this size; a bigger one or a clip is named
const SHOWN = 6 * 1024 * 1024;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** Register this module's channels; the drafts live in the app's own folder. */
export function registerCreatorIpc({ win }: Pick<AppContext, 'win'>): void {
  const { app, dialog, ipcMain } = electron();
  let creator: Creator | null = null;
  const store = () => (creator ||= createCreator({ userDataDir: app.getPath('userData') }));
  const answer = async <T>(fn: () => T | Promise<T>) => {
    try { return { ok: true as const, ...(await fn()) }; } catch (err) { return { error: errorText(err) }; }
  };
  /** A draft as the form shows it: its pictures, and what is still missing. */
  const shown = (d: Draft) => ({
    ...d,
    pictures: d.styles.map((s) => {
      if (!s.picture || !IMAGE.test(s.picture)) return null;
      const p = path.join(store().folder(d.id), s.picture);
      // the size and the bytes from one open file, so what is measured is what is read
      let fd: number | null = null;
      try {
        fd = fs.openSync(p, 'r');
        if (fs.fstatSync(fd).size > SHOWN) return null;
        return `data:${MIME[path.extname(p).toLowerCase()]};base64,${fs.readFileSync(fd).toString('base64')}`;
      } catch { return null; } finally { if (fd !== null) fs.closeSync(fd); }
    }),
    missing: store().missing(d),
  });

  ipcMain.handle('creator:list', () => answer(() => ({ drafts: store().list().map(shown) })));
  ipcMain.handle('creator:save', (e, id, fields) => answer(() => ({ draft: shown(store().save(id || null, fields || {})) })));
  ipcMain.handle('creator:attach', (e, id, style, kind) => answer(async () => {
    const vpk = kind === 'vpk';
    const res = await dialog.showOpenDialog(win(), {
      title: vpk ? t('VPK мода') : t('Картинка мода'),
      properties: ['openFile'],
      filters: vpk ? [{ name: 'VPK', extensions: ['vpk'] }] : [{ name: t('Картинки и видео'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { cancelled: true };
    return { draft: shown(store().attach(id, style, vpk ? 'vpk' : 'picture', res.filePaths[0])) };
  }));
  ipcMain.handle('creator:remove', (e, id) => answer(() => { store().remove(id); return {}; }));
  ipcMain.handle('creator:export', (e, id) => answer(async () => {
    const { name, zip } = store().bundle(id);
    const res = await dialog.showSaveDialog(win(), {
      title: t('Сохранить мод для каталога'),
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePath) return { cancelled: true };
    fs.writeFileSync(res.filePath, zip);
    return { path: res.filePath, size: zip.length };
  }));
}

/* Installing, removing, switching and importing mods: the channels the Library screen and
 * the catalog's install buttons reach for. What My mods is drawn from (mods:list) is built in
 * src/mods-listing.ts.
 *
 * Everything the handlers use arrives as an argument, so the list at the top of the function is
 * an honest answer to "what does managing a mod actually touch".
 */
import fs from 'node:fs';
import path from 'node:path';

import { t } from './i18n.ts';
import { fetchMirrored } from './net.ts';
import { fileUrl } from './installer-downloads.ts';
import { createTerrainAges, TAIL_BYTES } from './terrain-age.ts';
import { createNoticeText } from './notice-text.ts';
import { createModsListing } from './mods-listing.ts';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';
import type { LibRecord } from './types.ts';

/** Register this module's channels, over the services and callbacks src/main.ts hands it. */
export function registerModsIpc({
  applyMasterToCursors, blocked, catalog, diag, disableOtherCursors, fingerprints, importVpkBuffers, importVpkPaths, installer, isCursorRecord, library, refreshPresence, schemaService, sendProgress, updateImpact, verifyStuck, win,
}: Pick<AppContext, 'applyMasterToCursors' | 'blocked' | 'catalog' | 'diag' | 'disableOtherCursors' | 'fingerprints' | 'importVpkBuffers' | 'importVpkPaths' | 'installer' | 'isCursorRecord' | 'library' | 'refreshPresence' | 'schemaService' | 'sendProgress' | 'updateImpact' | 'verifyStuck' | 'win'>): void {
  const { dialog, ipcMain } = electron();
  // `win` arrives as a getter, not as the window. These are registered before the window
  // is created, so a value captured here would be undefined forever - which is exactly
  // what win:isMaximized did on the first run after this file was split out.

  // whole-map terrains against the game's own map (src/terrain-age.ts)
  const terrainAges = createTerrainAges({
    downloadsDir: installer.downloadsDir,
    gamePath: () => (installer.getGamePath ? installer.getGamePath() : null),
    storeFile: installer.downloadsDir && path.join(path.dirname(installer.downloadsDir), 'terrain-ages.json'),
    fetchTail: async (categoryId, file) => {
      // the same address an install downloads from
      const res = await fetchMirrored(fileUrl(categoryId, file), { headers: { Range: `bytes=-${TAIL_BYTES}` } });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    },
  });
  const switchOff = (rec: LibRecord) => { installer.setEnabled(rec.files, false, rec.id); library.setEnabled(rec.id, false); };
  // the anti-cheat notice in plain words (src/notice-text.ts)
  const notice = createNoticeText({ gamePath: () => (installer.getGamePath ? installer.getGamePath() : null), langDir: () => installer.langFolder(), diag });
  const listMods = createModsListing({ installer, library, fingerprints, schemaService, updateImpact, terrainAges, notice, diag, refreshPresence, verifyStuck });
  // the pre-patch mark taken off one mod by hand (src/update-impact.ts)
  ipcMain.handle('mods:clearPrePatch', (e, id) => {
    if (typeof id !== 'string' || !library.find(id)) return { error: t('Мод не найден') };
    updateImpact.clear(id);
    return { ok: true };
  });
  ipcMain.handle('mods:install', async (e, payload) => {
    // payload: { categoryId, name, styleLabel, fileRef, preview }
    const stop = blocked('install');
    if (stop) return stop;
    try {
      const existing = library.findByKey(payload.categoryId, payload.name, payload.styleLabel);
      if (existing) return { error: t('Уже установлено'), already: true };
      // a cursor set is written straight over the one in resource\cursor, so the set that
      // is on has to step aside first — otherwise its files are gone with no way back
      const replaced = payload.categoryId === 'cursors' ? disableOtherCursors(null) : [];
      const files = await installer.install({
        categoryId: payload.categoryId,
        modName: payload.name,
        fileRef: payload.fileRef,
      });
      const rec = library.add({ ...payload, files });
      // a whole-map terrain keeps the date its map was built, while the archive is at hand
      const mapBuiltAt = terrainAges.builtAtOf(rec);
      if (Number.isFinite(mapBuiltAt)) library.update(rec.id, { mapBuiltAt });
      // lift any item-schema changes out of the mod and rebuild the schema pak
      const harvest = schemaService.harvest(rec);
      if (harvest && harvest.deltas) schemaService.refresh();
      // keep the set's own copy, so it can be switched back on later without a re-download
      if (payload.categoryId === 'cursors') { try { installer.ensureCursorStore(rec.id, files); } catch { /* noop */ } }
      // installed while the master switch is off? sweep the fresh file off too, so the
      // library state stays consistent (all mods off) until the user turns them back on.
      if (installer.masterIsOff()) {
        try { installer.setMasterEnabled(false); } catch { /* noop */ }
        applyMasterToCursors(false);
      }
      sendProgress({ type: 'done', label: payload.name });
      return { ok: true, record: rec, replaced };
    } catch (err) {
      sendProgress({ type: 'error', label: payload.name, message: errorText(err) });
      return { error: errorText(err) };
    }
  });

  ipcMain.handle('mods:exportSingle', async (e, id) => {
    const rec = library.find(id);
    if (!rec) return { error: t('Мод не найден') };
    try {
      // a cursor set is loose files, not a pak — it travels as the zip the catalog uses
      const cursor = isCursorRecord(rec);
      const buf = cursor ? installer.cursorZip(rec) : installer.mergeToSingleVpk(rec, rec.schema);
      const safe = rec.name.replace(/[<>:"/\\|?*]/g, '_') || 'mod';
      const res = await dialog.showSaveDialog(win(), {
        title: cursor ? t('Сохранить курсор архивом') : t('Сохранить мод одним .vpk файлом'),
        defaultPath: `${safe}.${cursor ? 'zip' : 'vpk'}`,
        filters: [cursor
          ? { name: t('Архив курсора'), extensions: ['zip'] }
          : { name: t('VPK мод'), extensions: ['vpk'] }],
      });
      if (res.canceled || !res.filePath) return { cancelled: true };
      fs.writeFileSync(res.filePath, buf);
      return { ok: true, path: res.filePath, size: buf.length };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  // The other half of "pack a folder": hand the author back the files themselves, so a mod
  // can be opened, changed and dropped in again without any other tool.
  ipcMain.handle('mods:unpackToFolder', async (e, id) => {
    const rec = library.find(id);
    if (!rec) return { error: t('Мод не найден') };
    try {
      const res = await dialog.showOpenDialog(win(), {
        title: t('Куда распаковать мод'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || !res.filePaths.length) return { cancelled: true };
      const safe = rec.name.replace(/[<>:"/\\|?*]/g, '_') || 'mod';
      const dest = path.join(res.filePaths[0], safe);
      fs.mkdirSync(dest, { recursive: true });
      const out = installer.unpackToFolder(rec, dest);
      return { ok: true, path: dest, ...out };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  ipcMain.handle('mods:importDialog', async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: t('Выбери .vpk файлы модов или .zip с ними'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('Моды (.vpk, .zip)'), extensions: ['vpk', 'zip'] }],
    });
    if (res.canceled || !res.filePaths.length) return { cancelled: true };
    return importVpkPaths(res.filePaths);
  });

  // folder picker — Windows can't offer files and folders in one dialog, so a pack that
  // unzipped to a whole game tree (Skinchanger) gets its own entry point
  ipcMain.handle('mods:importFolderDialog', async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: t('Выбери папку с модами'),
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { cancelled: true };
    return importVpkPaths(res.filePaths);
  });

  ipcMain.handle('mods:importPaths', (e, paths) => importVpkPaths(Array.isArray(paths) ? paths : []));
  ipcMain.handle('mods:importBuffers', (e, items) => importVpkBuffers(items));

  ipcMain.handle('mods:list', () => listMods());

  /* Once per map the game has: a whole-map terrain older than it goes off, and the window says
   * which. Asked at start and after the game updates (renderer/core/terrain-age.ts). */
  ipcMain.handle('mods:switchOffStaleTerrains', () => {
    try {
      return { names: terrainAges.switchOffStale(library.list(), switchOff) };
    } catch (err) {
      return { names: [], error: errorText(err) };
    }
  });

  // When each whole-map terrain in the catalog was built, for the mark on its card.
  ipcMain.handle('catalog:terrainAges', async () => {
    try {
      const c = await catalog.load();
      const data = (c.mods?.modsData || c.mods || {}) as Record<string, unknown>;
      const terrains = (data.terrains as { file?: string }[] | undefined) || [];
      return await terrainAges.forCatalog(terrains, (file) => catalog.publishedHash('terrains', file));
    } catch (err) {
      return { mapAt: null, ages: {}, stale: {}, error: errorText(err) };
    }
  });
}

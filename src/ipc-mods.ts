/* Installing, removing, switching and importing mods: the channels the Library screen and
 * the catalog's install buttons reach for.
 *
 * Everything the handlers use arrives as an argument, so the list at the top of the function is
 * an honest answer to "what does managing a mod actually touch".
 */
import fs from 'node:fs';
import path from 'node:path';

import { t } from './i18n.ts';
import { fetchMirrored } from './net.ts';
import { RAW_BASE } from './catalog.ts';
import { createTerrainAges, TAIL_BYTES } from './terrain-age.ts';
import { createNoticeText } from './notice-text.ts';
import * as zones from './slot-zones.ts';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';
import type { ForeignItem } from './installer-folder.ts';
import type { CatalogIdentity } from './fingerprints.ts';
import type { LibRecord } from './types.ts';

/** A file in the language folder the app did not put there, as My mods lists it. */
type ExternalRow = Omit<ForeignItem, 'kind'> & {
  /** a font set is found by matching the fonts folder against the catalog, not by a pak */
  kind: ForeignItem['kind'] | 'font';
  /** the catalog mods this file is byte for byte */
  match?: CatalogIdentity[] | null;
  /** the library mod it is a leftover copy of */
  duplicateOf?: string;
  coveredBy?: { name: string; files: number }[];
};

/** Register this module's channels, over the services and callbacks main.js hands it. */
export function registerModsIpc({
  applyMasterToCursors, blocked, catalog, diag, disableOtherCursors, fingerprints, importVpkBuffers, importVpkPaths, installer, isCursorRecord, library, refreshPresence, schemaService, sendProgress, verifyStuck, win,
}: Pick<AppContext, 'applyMasterToCursors' | 'blocked' | 'catalog' | 'diag' | 'disableOtherCursors' | 'fingerprints' | 'importVpkBuffers' | 'importVpkPaths' | 'installer' | 'isCursorRecord' | 'library' | 'refreshPresence' | 'schemaService' | 'sendProgress' | 'verifyStuck' | 'win'>): void {
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
      const url = `${RAW_BASE}/assets/files/${categoryId}/${encodeURIComponent(file)}`; // as installer.js fileUrl
      const res = await fetchMirrored(url, { headers: { Range: `bytes=-${TAIL_BYTES}` } });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    },
  });
  const switchOff = (rec: LibRecord) => { installer.setEnabled(rec.files, false, rec.id); library.setEnabled(rec.id, false); };
  // the anti-cheat notice in plain words (src/notice-text.ts)
  const notice = createNoticeText({ gamePath: () => (installer.getGamePath ? installer.getGamePath() : null), langDir: () => installer.langFolder(), diag });
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

  ipcMain.handle('mods:list', () => {
    // a mod still on the slot the notice text took moves off it (src/slot-zones.ts)
    try { if (zones.vacateAppPak(installer, library)) diag('a mod moved off the notice slot'); } catch (err) { diag(`notice slot not freed: ${errorText(err)}`); }
    // folder sync: a mod deleted straight from the game folder drops out of the library
    try {
      for (const rec of [...library.list()]) {
        if (rec.kind === 'pack') {
          if ((rec.files || []).length && !installer.langPrimaryPresent(rec)) {
            installer.removePackFully(rec);
            library.removeRecord(rec.id);
          }
        } else if (!installer.langPrimaryPresent(rec)) {
          library.removeRecord(rec.id);
        }
      }
    } catch { /* no game path yet — nothing to sync */ }

    let external: ExternalRow[] = [];
    // fingerprint -> a mod already in the library, so a file that is byte-identical to
    // something managed can be called what it is (a leftover copy) instead of a mystery
    const installedFps = new Map<string, string>();
    try {
      for (const rec of library.list()) {
        if (rec.kind === 'pack') continue;
        const a = installer.analyzeRecord(rec);
        if (a && a.fp && !installedFps.has(a.fp)) installedFps.set(a.fp, rec.name);
      }
    } catch { /* no game path — nothing to compare against */ }
    try {
      const known = library.knownFiles();
      const canMatch = fingerprints.hasData();
      external = installer.externalFiles(known, { scanExtras: canMatch });
      for (const f of external) {
        if (!f.fp) continue;
        f.match = fingerprints.match(f.fp); // recognise catalog mods
        if (installedFps.has(f.fp)) f.duplicateOf = installedFps.get(f.fp);
      }
      // lang-root files are always worth listing; maps/cursor only when recognised
      external = external.filter((f) => f.primary || f.match);
      // fonts share panorama\fonts with vanilla — subset-match instead of a folder fp
      if (canMatch && fingerprints.fonts.length && !known.some((f) => f.root === 'fonts')) {
        const fh = installer.fontFolderHashes();
        for (const m of (fh ? fingerprints.matchFonts(fh) : [])) {
          external.push({
            kind: 'font', key: `__font__${m.name}`, name: m.name, primary: false,
            size: 0, enabled: true, files: Object.keys(m.files).map((bn) => ({ root: 'fonts', relPath: bn })),
            match: [{ name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel || null }],
          });
        }
      }
    } catch { /* lang folder may not exist yet */ }
    // imported mods have no catalog identity — tag them by content, match to catalog if known
    const installed = library.list().map((rec) => {
      if (rec.categoryId !== 'imported') return rec;
      try {
        const a = installer.analyzeRecord(rec);
        // fpOriginal: the file was repacked to drop the whole-game tables it shipped, so
        // match on what it hashed to before that, or a recognised mod becomes unknown
        const matches = fingerprints.match(rec.fpOriginal || a?.fp);
        // one-time: give bare "pakNN" imports a real name — the catalog name if the file
        // is recognised, otherwise the content (hero / set / kind)
        if (/^!?pak\d+$/i.test(rec.name)) {
          const dir = rec.files.find((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
          const nm = (matches && matches[0] && matches[0].name) || (dir && installer.displayNameForFile(dir.relPath));
          if (nm && nm !== rec.name) { library.update(rec.id, { name: nm }); rec.name = nm; }
        }
        return { ...rec, ...a, match: matches };
      } catch { return rec; }
    });
    // Who is quietly covering whom. Both lists take part: a foreign file in the folder is
    // mounted by the game exactly like a managed one, so leaving it out would name the wrong
    // winner. Only switched-on mods, because a switched-off one is renamed and never mounted.
    let covered = new Map();
    try {
      const live = [
        ...installed.filter((r) => r.enabled).map((r) => ({ key: r.id, name: r.name, files: r.files })),
        ...external.filter((f) => f.enabled).map((f) => ({ key: f.key, name: f.name, files: f.files })),
      ];
      covered = installer.coverage(live);
    } catch { /* no game path — nothing is mounted, nothing covers anything */ }
    external = external.map((f) => (covered.has(f.key) ? { ...f, coveredBy: covered.get(f.key) } : f));

    // a whole-map terrain built for an older map than the game's: marked on its row, and its
    // build date kept on the record once found, so a cleared download cache does not lose it
    let terrains = new Map();
    try {
      terrains = terrainAges.forRecords(installed);
      for (const [id, a] of terrains) {
        const rec = library.find(id);
        if (rec && Number.isFinite(a.builtAt) && rec.mapBuiltAt !== a.builtAt) library.update(id, { mapBuiltAt: a.builtAt });
      }
    } catch { /* no game path */ }

    let slots = 0;
    try { slots = installer.usedModSlots(); } catch { /* no game path */ }
    /* Leave a note on disk saying which files here are ours. This handler already reconciles
     * the library against the folder and the renderer re-lists after every install, toggle,
     * preset and bulk action, so it is the one place that keeps the note honest without
     * hooking a dozen handlers - the same reason refreshPresence() sits here. */
    const noteOwnership = () => {
      try { installer.writeOwnership([...library.knownLangRelPaths(), ...notice.ownedFiles()]); } catch (err) { diag(`ownership note skipped: ${errorText(err)}`); }
    };
    noteOwnership();
    // The anti-cheat notice in plain words (src/notice-text.ts), kept current from here for the
    // same reason. After the reply: a rebuild reads the game's own index, and the list is what
    // the screen is waiting for. A rebuild that wrote or removed the pak writes the note again,
    // or the note would miss it until the next listing.
    setImmediate(() => { if (notice.refresh()) noteOwnership(); });
    // the renderer re-lists after every install, toggle, preset and bulk action, so this is
    // the one place that keeps the Discord status honest without hooking a dozen handlers
    refreshPresence();
    // The lifted item blocks are only ever needed in the main process; the renderer just
    // shows that a mod has them, and whether the patch that makes them work is on. Copies,
    // never the stored records — dropping the field off those would erase it on save.
    const schemaOn = schemaService.state().enabled;
    // zone: which part of the load order the mod belongs in (installer.js, PRIORITY_SLOTS), so
    // the screen knows where "load earlier" stops
    const listed = installed.map((rec) => {
      const by = covered.get(rec.id);
      const zone = installer.zoneFor(rec.categoryId);
      const staleMap = !!terrains.get(rec.id)?.stale;
      if (!Array.isArray(rec.schema)) return { ...rec, zone, staleMap, ...(by ? { coveredBy: by } : {}) };
      const { schema, ...rest } = rec;
      return { ...rest, zone, staleMap, schemaCount: schema.length, schemaLive: schemaOn, ...(by ? { coveredBy: by } : {}) };
    });
    return { installed: listed, external, slots, slotCeil: 98, verifyStuck: verifyStuck() };
  });

  /* Once per map the game has: a whole-map terrain older than it goes off, and the window says
   * which. Asked at start and after the game updates (renderer/core/terrain-age.js). */
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

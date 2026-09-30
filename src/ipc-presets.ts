/* The preset channels: everything the Presets screen can ask for.
 *
 * Twelve handlers, and almost all of them are one line of validation over src/presets-service,
 * which is where the thinking lives. Keeping them here rather than in main.js means the whole
 * preset domain - what a preset is, how it travels, and how the screen reaches it - is three
 * files that name each other, instead of two of them being buried a thousand lines apart in
 * the file that starts the window.
 */
import fs from 'node:fs';

import { Library } from './library.ts';
import { readPresetFile, writePresetFile } from './preset-share.ts';
import { encodePresetLink } from './preset-link.ts';
import { installVpkBuffer } from './import.ts';
import { t } from './i18n.ts';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';
import type { CatalogIndex, ShareEntry } from './presets-service.ts';
import type { EntryToWrite } from './preset-share.ts';
import type { LibRecord, ModIdentity, PresetEntry } from './types.ts';

/** Register this module's channels, over the services and callbacks main.js hands it. */
export function registerPresetsIpc({
  win, settings, catalog, installer, library, schemaService, presets,
  adoptImportedFiles, afterDeployMaster, disableOtherCursors, sendProgress,
}: Pick<AppContext, 'win' | 'settings' | 'catalog' | 'installer' | 'library' | 'schemaService' | 'presets' | 'adoptImportedFiles' | 'afterDeployMaster' | 'disableOtherCursors' | 'sendProgress'>): void {
  const { app, dialog, ipcMain } = electron();
  // `win` arrives as a getter, not as the window. These are registered before the window
  // is created, so a value captured here would be undefined forever - which is exactly
  // what win:isMaximized did on the first run after this file was split out.

  /* One mod out of the catalog, by the name a preset remembers it under, into the library.
   * Answers the record, or null with the reason pushed onto `errors`.
   *
   * A received preset being installed and an own preset whose mods have gone both need this,
   * and it was written once, inside the first of them. Two copies of "install from the
   * catalog" is how one of them ends up without the rule that only one cursor set is live. */
  async function installFromCatalog(
    { categoryId, name, styleLabel }: Pick<ModIdentity, 'categoryId' | 'name' | 'styleLabel'>,
    cat: CatalogIndex,
    errors: string[],
  ): Promise<LibRecord | null> {
    const have = library.findByKey(categoryId, name, styleLabel);
    if (have) return have;
    const hit = cat.lookup(categoryId, name, styleLabel);
    // an entry with no file to fetch is as good as absent, and saying so beats a download of "undefined"
    if (!hit?.fileRef) { errors.push(`${name}: ${t('нет в каталоге')}`); return null; }
    if (hit.categoryId === 'cursors') disableOtherCursors(null); // one cursor at a time
    const files = await installer.install({ categoryId: hit.categoryId, modName: hit.name, fileRef: hit.fileRef });
    const rec = library.add({
      categoryId: hit.categoryId, name: hit.name, styleLabel: hit.styleLabel,
      fileRef: hit.fileRef, preview: hit.preview, files,
    });
    if (hit.categoryId === 'cursors') { try { installer.ensureCursorStore(rec.id, files); } catch { /* noop */ } }
    return rec;
  }

  ipcMain.handle('presets:list', async () => {
    const cat = await presets.catalogIndex();
    return Promise.all(library.listPresets().map(async (p) => {
      // a received preset shows what installing it would cost before anything downloads
      if (p.wanted) return { ...p, status: await presets.sharedPresetStatus(p, cat).catch(() => null) };
      // an own preset says how much of it a link could carry, so the button can explain
      // itself instead of quietly disappearing
      const { mods, skipped } = presets.presetLinkMods(p, cat);
      // A build names mods, not installations, so some of them may not be here right now.
      // The screen shows the whole set and says which part of it is missing, rather than
      // quietly listing the leftovers as if that were the build.
      const members = library.presetMembers(p);
      return {
        ...p,
        modIds: members.flatMap((m) => (m.rec ? [m.rec.id] : [])),
        absent: members.filter((m) => !m.rec).map((m) => m.identity),
        link: { count: mods.length, skipped },
      };
    }));
  });
  ipcMain.handle('presets:save', (e, name) => {
    library.savePreset(name);
    return library.listPresets();
  });
  // overwrite a preset with the current on/off state — the "save" the user actually means
  // when they have tweaked a build they already named
  ipcMain.handle('presets:update', (e, id) => {
    const p = library.updatePresetMods(id);
    if (!p) return { error: t('Пресет не найден') };
    return { ok: true, count: (p.mods || []).length };
  });

  ipcMain.handle('presets:rename', (e, id, name) => {
    const clean = String(name || '').trim().slice(0, 120);
    if (!clean) return { error: t('Введи название пресета') };
    if (!library.updatePreset(id, { name: clean })) return { error: t('Пресет не найден') };
    return { ok: true, name: clean };
  });

  ipcMain.handle('presets:delete', (e, id) => {
    presets.dropSharedPresetFile(library.getPreset(id));
    library.deletePreset(id);
    return library.listPresets();
  });
  /* A build remembers its mods by name, so some of them may not be installed any more: deleted
   * since, or saved on another machine. Applying used to switch every other mod off, switch on
   * only the members that happened to be here, and answer "Preset applied" - so pressing it on
   * a build whose mods had gone left somebody with fewer mods than before, nothing installed,
   * and a message saying it had worked. The card had been saying "3 not installed" the whole
   * time; the button just never acted on it.
   *
   * Now whatever the catalog still has is installed first. A mod of the user's own cannot be
   * fetched back from anywhere, so it is left out and named, rather than silently. */
  ipcMain.handle('presets:apply', async (e, id) => {
    const preset = library.getPreset(id);
    if (!preset) return { error: t('Пресет не найден') };
    const absent = library.presetMembers(preset).filter((m) => !m.rec).map((m) => m.identity);
    const missing: string[] = [];
    const errors: string[] = [];
    let installed = 0;
    if (absent.length) {
      const cat = await presets.catalogIndex();
      for (const identity of absent) {
        if (identity.categoryId === 'imported') { missing.push(identity.name); continue; }
        try {
          sendProgress({ type: 'stage', label: identity.name, stage: t('установка') });
          if (await installFromCatalog(identity, cat, errors)) installed++;
        } catch (err) {
          errors.push(`${identity.name}: ${errorText(err)}`);
        }
      }
    }
    const toggleErrors = presets.applyPreset(preset);
    if (installed) {
      afterDeployMaster();
      sendProgress({ type: 'done', label: preset.name });
    }
    // A mod that could not be switched is the preset failing, exactly as before. A member that
    // could not be fetched is the preset applying without it, and is said as a warning.
    if (toggleErrors.length) return { error: [...errors, ...toggleErrors].join('\n') };
    return { ok: true, installed, missing, errors };
  });

  // ----- sharing presets as .d2mm -----

  ipcMain.handle('presets:exportPlan', async (e, id) => {
    const preset = library.getPreset(id);
    if (!preset) return { error: t('Пресет не найден') };
    try {
      return { name: preset.name, entries: presets.planShape(await presets.presetShareEntries(preset)) };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  ipcMain.handle('presets:export', async (e, id, opts) => {
    const preset = library.getPreset(id);
    if (!preset) return { error: t('Пресет не найден') };
    const safe = preset.name.replace(/[<>:"/\\|?*]/g, '_') || 'preset';
    const res = await dialog.showSaveDialog(win(), {
      title: t('Сохранить пресет для друга'),
      defaultPath: `${safe}.d2mm`,
      filters: [{ name: t('Пресет Mod Manager'), extensions: ['d2mm'] }],
    });
    if (res.canceled || !res.filePath) return { cancelled: true };
    try {
      const skip = new Set((opts && opts.skip) || []);
      sendProgress({ type: 'stage', label: preset.name, stage: t('сборка пресета') });
      // pull the bytes only now, and only for what the user kept ticked
      const prep = (entry: ShareEntry, key: string): EntryToWrite => {
        if (entry.kind === 'pack') return { ...entry, members: entry.members.map((m, j) => prep(m, `${key}.${j}`)) };
        if (entry.kind !== 'embedded') return entry;
        if (skip.has(key)) return { kind: 'missing', name: entry.name, reason: t('отправитель не вложил файл') };
        const { loadData, ...rest } = entry;
        return { ...rest, data: loadData() };
      };
      const entries = (await presets.presetShareEntries(preset)).map((entry, i) => prep(entry, String(i)));
      const written = writePresetFile(res.filePath, {
        name: preset.name,
        note: (opts && String(opts.note || '').slice(0, 600)) || '',
        author: { name: (opts && String(opts.author || '').slice(0, 80)) || '' },
        app: app.getVersion(),
        catalogFetchedAt: catalog.cacheInfo().fetchedAt,
      }, entries);
      sendProgress({ type: 'done', label: preset.name });
      return { ok: true, path: written.path, size: written.size };
    } catch (err) {
      sendProgress({ type: 'error', label: preset.name, message: errorText(err) });
      return { error: errorText(err) };
    }
  });

  ipcMain.handle('presets:shareLink', async (e, id) => {
    const preset = library.getPreset(id);
    if (!preset) return { error: t('Пресет не найден') };
    try {
      const { mods, skipped } = presets.presetLinkMods(preset, await presets.catalogIndex());
      if (!mods.length) return { error: t('В пресете только свои моды — ссылка их не донесёт, отправь файлом') };
      const account = settings.get('account');
      const link = encodePresetLink({ name: preset.name, author: account?.username, mods });
      return { ok: true, ...link, count: mods.length, skipped };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  ipcMain.handle('presets:importDialog', async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: t('Выбери файл пресета (.d2mm)'),
      properties: ['openFile'],
      filters: [{ name: t('Пресет Mod Manager'), extensions: ['d2mm'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { cancelled: true };
    return presets.importPresetFile(res.filePaths[0]);
  });

  ipcMain.handle('presets:importFile', (e, filePath) => presets.importPresetFile(filePath));

  ipcMain.handle('presets:resolve', async (e, id) => {
    const preset = library.getPreset(id);
    if (!preset || !preset.wanted) return { error: t('Пресет не найден') };
    const stash = preset.source && preset.source.file;
    let bundle = null;
    if (stash && fs.existsSync(stash)) {
      try { bundle = readPresetFile(stash); } catch (err) { return { error: errorText(err) }; }
    }
    const cat = await presets.catalogIndex();
    const fpIndex = presets.installedFpIndex();
    const errors: string[] = [];
    let schemaTouched = false;

    // -> ids of the library records that now provide this mod (a multi-hero bundle splits
    // into several), or an empty list when it could not be resolved at all
    const resolveEntry = async (entry: PresetEntry): Promise<string[]> => {
      try {
        if (entry.kind === 'catalog') {
          const rec = await installFromCatalog(entry, cat, errors);
          return rec ? [rec.id] : [];
        }
        if (entry.kind === 'embedded') {
          const onDisk = entry.fp && fpIndex.get(entry.fp);
          if (onDisk) return [onDisk]; // already on disk
          if (!bundle) { errors.push(`${entry.name}: ${t('файл пресета недоступен')}`); return []; }
          sendProgress({ type: 'stage', label: entry.name, stage: t('установка') });
          const files = installVpkBuffer(installer, bundle.readMod(entry.file));
          // exactly the treatment a dragged-in file gets: the sender's item blocks lifted
          // out, a multi-hero bundle split, a name from the content when theirs is a slot
          const { records, schema } = adoptImportedFiles({ files, name: entry.name, fileRef: null });
          if (schema) schemaTouched = true;
          if (entry.fp && records.length === 1) fpIndex.set(entry.fp, records[0].id);
          return records.map((r) => r.id);
        }
        if (entry.kind === 'cosmetic') {
          const rec = schemaService.pickCosmetic(entry.slot, entry.itemId, entry.name, entry.effectId);
          return rec ? [rec.id] : [];
        }
        const why = entry.kind === 'missing' ? entry.reason : '';
        errors.push(`${entry.name}: ${why || t('нет в файле')}`);
        return [];
      } catch (err) {
        errors.push(`${entry.name}: ${errorText(err)}`);
        return [];
      }
    };

    const ids: string[] = [];
    for (const entry of preset.wanted) {
      if (entry.kind === 'pack') {
        const memberIds: string[] = [];
        for (const m of entry.members) memberIds.push(...await resolveEntry(m));
        const built = presets.packFromRecords(entry.name, memberIds);
        if (built) ids.push(built.id); else ids.push(...memberIds);
      } else {
        ids.push(...await resolveEntry(entry));
      }
    }

    // the picks a sender's file asked for are made, but they do not join the build: from
    // here this is an ordinary preset, and those hold mods only
    const landed = [...new Set(ids)].map((id) => library.find(id)).filter((r): r is LibRecord => Library.inPreset(r));
    preset.mods = landed.map(Library.identityOf);
    delete preset.modIds;
    delete preset.wanted;                       // resolved: it's an ordinary preset now
    if (preset.source) preset.source.file = null;
    library.save();
    if (stash) { try { fs.rmSync(stash, { force: true }); } catch { /* noop */ } }

    errors.push(...presets.applyPreset(preset));
    // a mod that arrived already enabled never passes through applyPreset's own switch, so
    // its freshly lifted blocks would sit in the library without ever reaching the build
    if (schemaTouched) schemaService.refresh();
    afterDeployMaster();
    sendProgress({ type: 'done', label: preset.name });
    return { ok: true, installed: preset.mods.length, errors };
  });
}

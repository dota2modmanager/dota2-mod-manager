/* The preset channels: everything the Presets screen can ask for.
 *
 * Twelve handlers, and almost all of them are one line of validation over src/presets-service,
 * which is where the thinking lives. Keeping them here rather than in src/main.ts means the whole
 * preset domain - what a preset is, how it travels, and how the screen reaches it - is three
 * files that name each other, instead of two of them being buried a thousand lines apart in
 * the file that starts the window.
 */
import { writePresetFile } from './preset-share.ts';
import { encodePresetLink } from './preset-link.ts';
import { createPresetInstall } from './preset-install.ts';
import { getLang, t } from './i18n.ts';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import type { AppContext } from './app-context.ts';
import type { ShareEntry } from './presets-service.ts';
import type { EntryToWrite } from './preset-share.ts';
import type { PresetEntry } from './types.ts';

/** Register this module's channels, over the services and callbacks src/main.ts hands it. */
export function registerPresetsIpc({
  win, settings, catalog, installer, library, schemaService, presets, readyPresets: ready,
  adoptImportedFiles, afterDeployMaster, disableOtherCursors, sendProgress, blocked,
}: Pick<AppContext, 'win' | 'settings' | 'catalog' | 'installer' | 'library' | 'schemaService' | 'presets' | 'readyPresets' | 'adoptImportedFiles' | 'afterDeployMaster' | 'disableOtherCursors' | 'sendProgress' | 'blocked'>): void {
  const { app, dialog, ipcMain } = electron();
  // `win` arrives as a getter, not as the window. These are registered before the window
  // is created, so a value captured here would be undefined forever - which is exactly
  // what win:isMaximized did on the first run after this file was split out.

  const flows = createPresetInstall({ installer, library, schemaService, presets, adoptImportedFiles, afterDeployMaster, disableOtherCursors, sendProgress, blocked });

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
      return { ...p, on: presets.presetState(p), // which one you are in
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
  // an own preset: its missing catalog mods fetched back first (src/preset-install.ts)
  ipcMain.handle('presets:apply', async (e, id) => {
    const preset = library.getPreset(id);
    if (!preset) return { error: t('Пресет не найден') };
    return flows.applyOwn(preset);
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
    return flows.resolve(preset as typeof preset & { wanted: PresetEntry[] });
  });

  // The ready-made presets (issue #391): fetched once a start by src/services.ts, and answered from
  // the last good copy until then. One that was taken already says so, by its id in the taken
  // preset's source, so a second press does not make a second copy of it.
  const takenFrom = (id: string) => library.listPresets().find((p) => (p.source as { ready?: string } | undefined)?.ready === id);
  ipcMain.handle('presets:ready', () => {
    const ru = getLang() === 'ru';
    return ready.list().map((p) => ({
      id: p.id, name: ru ? p.ru : p.en, about: ru ? p.about.ru || p.about.en : p.about.en || p.about.ru,
      mods: p.mods, taken: takenFrom(p.id)?.id || null,
    }));
  });
  // One press: the preset lands as a received one and is installed and applied straight away, the
  // way a received preset's Install does it
  ipcMain.handle('presets:takeReady', async (e, id) => {
    const p = ready.get(String(id));
    if (!p) return { error: t('Пресет не найден') };
    const ru = getLang() === 'ru';
    const preset = takenFrom(p.id) || library.addSharedPreset({
      name: ru ? p.ru : p.en, note: ru ? p.about.ru : p.about.en, author: 'Dota 2 Mod Manager',
      wanted: p.mods.map((m) => ({ kind: 'catalog' as const, ...m, fp: null })),
    });
    if (preset.source) (preset.source as { ready?: string }).ready = p.id;
    library.save();
    if (!preset.wanted) return flows.applyOwn(preset);
    return flows.resolve(preset as typeof preset & { wanted: PresetEntry[] });
  });
}

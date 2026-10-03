/* Files the app did not install, as My mods lists them: switching one off and on, removing it
 * with its data volumes, taking it into the library (recognised as a catalog mod or as an
 * import), recognising a cursor set or a font installed by hand, and cutting a file with several
 * heroes into one mod per hero. An import already in the library can be linked to the catalog
 * or cut by hero here too.
 *
 * Moved out of src/ipc-library.ts, which keeps the switches, order and removal of the app's own.
 */
import fs from 'node:fs';
import path from 'node:path';

import { t } from './i18n.ts';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import { fingerprintFiles, fingerprintVpk, readVpkIndexFile } from './vpk.ts';
import type { AppContext } from './app-context.ts';
import type { LibRecord } from './types.ts';

/** Register this module's channels, over the services src/main.ts hands it. */
export function registerForeignIpc({
  fingerprints, installer, library, schemaService,
}: Pick<AppContext, 'fingerprints' | 'installer' | 'library' | 'schemaService'>): void {
  const { ipcMain } = electron();
  ipcMain.handle('mods:externalSetEnabled', (e, fileName, enabled) => {
    try {
      const lang = installer.langFolder();
      const base = fileName.replace(/\.off$/i, '');
      const on = path.join(lang, base);
      const off = on + '.off';
      if (enabled && fs.existsSync(off)) fs.renameSync(off, on);
      if (!enabled && fs.existsSync(on)) fs.renameSync(on, off);
      return { ok: true };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  ipcMain.handle('mods:externalRemove', (e, fileName) => {
    try {
      const lang = installer.langFolder();
      const base = fileName.replace(/\.off$/i, '');
      // the index alone leaves its data volumes behind as orphans the app then lists as
      // more foreign files — take the whole set, in whatever on/off state each part is in
      for (const rel of [base, ...installer.siblingParts(base)]) {
        for (const suf of ['', '.off']) {
          const abs = path.join(lang, rel + suf);
          if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
        }
      }
      return { ok: true };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  // split a merged multi-hero library record into one managed mod per hero
  ipcMain.handle('mods:splitMod', (e, id) => {
    const rec = library.find(id);
    if (!rec) return { error: t('Мод не найден') };
    try {
      if (!rec.files.some((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath))) {
        return { error: t('Нет _dir.vpk для разбора') };
      }
      // the service splits the files AND hands each part the item blocks that belong to it
      const parts = schemaService.split(rec);
      if (!parts || !parts.length) return { error: t('В файле меньше двух героев — разбирать нечего') };
      if (parts.some((p) => Array.isArray(p.schema) && p.schema.length)) schemaService.refresh();
      return { ok: true, count: parts.length, names: parts.map((p) => p.name) };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  // adopt an imported record whose content matches a catalog mod: relabel it to that
  // catalog identity so it's managed like a natively installed mod (no re-download)
  ipcMain.handle('mods:adoptMod', (e, id, preview) => {
    const rec = library.find(id);
    if (!rec) return { error: t('Мод не найден') };
    const a = installer.analyzeRecord(rec);
    const matches = a && fingerprints.match(a.fp);
    if (!matches) return { error: t('Совпадение с каталогом не найдено') };
    const m = matches[0]; // identical-content entries are interchangeable; take the first
    const fields: Partial<LibRecord> = { name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel || null };
    if (preview) fields.preview = preview; // catalog thumbnail resolved by the renderer
    library.update(id, fields);
    // now that its category is known, into its part of the load order (installer.moveToZone)
    const moved = installer.moveToZone({ ...rec, ...fields });
    if (moved) library.update(id, { files: moved });
    return { ok: true, name: m.name };
  });

  /**
   * Take a file someone dropped into the game folder by hand into the library.
   *
   * Recognised as a catalog mod, it joins under that identity (preview, category, updates).
   * Unrecognised, it still joins — as an import named after its content, exactly what
   * dragging the same file onto the app would have produced. Refusing everything the
   * fingerprint list had never seen is what left users with a nameless "external file" row
   * and no way out of it; the catalog is a nice-to-have, not the price of admission.
   */
  ipcMain.handle('mods:adoptExternal', (e, fileName, preview) => {
    try {
      const lang = installer.langFolder();
      const base = fileName.replace(/\.off$/i, '');
      const onDisk = ['', '.off'].map((s) => path.join(lang, base + s)).find((p) => fs.existsSync(p));
      if (!onDisk) return { error: t('Файл не найден в папке модов') };
      let matches = null;
      try { matches = fingerprints.match(fingerprintVpk(readVpkIndexFile(onDisk))); } catch { /* not a readable index */ }

      // the _dir.vpk plus any sibling data archives (<base>_NNN.vpk) — one mod, several files
      const files = [{ root: 'lang', relPath: base }];
      for (const part of installer.siblingParts(base)) files.push({ root: 'lang', relPath: part });

      const m = matches && matches[0]; // identical-content entries are interchangeable
      const identity = m
        ? { name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel || null, preview: preview || null }
        : { name: installer.displayNameForFile(base) || base.replace(/_dir\.vpk$/i, ''), categoryId: 'imported', styleLabel: null, preview: null };
      let rec = library.add({ ...identity, fileRef: fileName, files });
      // a file dropped in by hand keeps its name until now; its category decides its slot
      const placed = installer.moveToZone(rec);
      if (placed) rec = library.update(rec.id, { files: placed }) || { ...rec, files: placed };
      // A file dropped into the folder by something else has never been through an install,
      // so its item blocks are still sitting inside it doing nothing. Adopting is the moment
      // the app takes it over - lift them now, or the mod stays without its effects.
      const harvest = schemaService.harvest(rec);
      if (harvest && harvest.deltas) schemaService.refresh();
      // a file that arrived switched off keeps that state, the way an imported mod would not
      if (/\.off$/i.test(fileName)) library.setEnabled(rec.id, false);
      return { ok: true, name: identity.name, matched: !!m };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  // adopt a foreign font mod (its files present in panorama\fonts) as a catalog mod
  ipcMain.handle('mods:adoptFont', (e, name, preview) => {
    try {
      const fh = installer.fontFolderHashes();
      const m = fh && fingerprints.matchFonts(fh).find((x) => x.name === name);
      if (!m) return { error: t('Совпадение с каталогом не найдено') };
      library.add({ name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel || null, fileRef: m.name, preview: preview || null, files: Object.keys(m.files).map((bn) => ({ root: 'fonts', relPath: bn })) });
      return { ok: true, name: m.name };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  // adopt a foreign cursor set (resource\cursor) recognised as a catalog mod
  ipcMain.handle('mods:adoptCursor', (e, preview) => {
    try {
      const game = installer.getGamePath();
      if (!game) return { error: t('Путь к Dota 2 не задан') };
      const cursorDir = path.join(game, 'dota', 'resource', 'cursor');
      if (!fs.existsSync(cursorDir)) return { error: t('Папка курсора не найдена') };
      const files: { path: string; data: Buffer }[] = [];
      const rels: string[] = [];
      const walk = (d: string, pre: string) => {
        // the entry type comes with the listing: no stat before the read (js/file-system-race)
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          const rel = pre ? `${pre}/${e.name}` : e.name;
          if (e.isDirectory()) walk(full, rel);
          else if (e.isFile()) { files.push({ path: e.name.toLowerCase(), data: fs.readFileSync(full) }); rels.push(rel); }
        }
      };
      walk(cursorDir, '');
      const matches = fingerprints.match(fingerprintFiles(files));
      if (!matches) return { error: t('Совпадение с каталогом не найдено') };
      const m = matches[0];
      const rec = library.add({ name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel || null, fileRef: m.name, preview: preview || null, files: rels.map((rp) => ({ root: 'cursor', relPath: rp })) });
      // the set is on disk but not ours yet — keep a copy so it can be switched off and on
      try { installer.ensureCursorStore(rec.id, rec.files); } catch { /* noop */ }
      return { ok: true, name: m.name };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

  // split a merged multi-hero external file (placed in the game folder by another tool)
  ipcMain.handle('mods:splitExternal', (e, fileName) => {
    try {
      const lang = installer.langFolder();
      const base = fileName.replace(/\.off$/i, '');
      const parts = installer.splitVpkFile(base);
      if (!parts.length) return { error: t('В файле меньше двух героев — разбирать нечего') };
      for (const p of parts) {
        library.add({ name: p.name, categoryId: 'imported', styleLabel: null, fileRef: fileName, preview: null, files: p.files });
      }
      // delete the source _dir.vpk (and any multi-part data archives + .off variant)
      const origBase = base.replace(/_dir\.vpk$/i, '');
      for (const f of fs.readdirSync(lang)) {
        const n = f.toLowerCase().replace(/\.off$/i, '');
        if (n === base.toLowerCase() || new RegExp(`^${origBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{3}\\.vpk$`, 'i').test(n)) {
          fs.rmSync(path.join(lang, f), { force: true });
        }
      }
      return { ok: true, count: parts.length, names: parts.map((p) => p.name) };
    } catch (err) {
      return { error: errorText(err) };
    }
  });
}

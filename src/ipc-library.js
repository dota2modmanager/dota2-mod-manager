/* Managing mods that are already installed: the master switch, one mod's switch, load order,
 * removal one at a time and in batches, adopting files somebody put in the folder by hand, and
 * splitting a multi-volume archive back apart.
 *
 * Twenty-one channels and the largest block registerIpc() held. Bodies unchanged; what they
 * reach for is now a list at the top of the function instead of whatever the enclosing file
 * happened to have in scope.
 */
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

const { t } = require('./i18n.ts');
const { isMinifyPak } = require('./minify');
const { touchesSchema } = require('./presets-service');

/** @param {object} ctx  the services and main-process callbacks these channels use */
function registerLibraryIpc({
  applyMasterToCursors, catalog, disableOtherCosmetics, disableOtherCursors, fingerprints,
  installer, isCursorRecord, library, refreshPresence, schemaService,
}) {
  ipcMain.handle('mods:masterState', () => {
    try { return { off: installer.masterIsOff() }; } catch { return { off: false }; }
  });

  ipcMain.handle('mods:setMaster', (e, enabled) => {
    try {
      const r = installer.setMasterEnabled(!!enabled);
      applyMasterToCursors(!!enabled);
      refreshPresence();
      return { ok: true, ...r };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  ipcMain.handle('mods:setEnabled', (e, id, enabled) => {
    const rec = library.find(id);
    if (!rec) return { error: t('Мод не найден') };
    try {
      // only one cursor set — and only one look per cosmetic slot — can be live at a time
      const replaced = enabled && isCursorRecord(rec) ? disableOtherCursors(id)
        : enabled && rec.categoryId === 'cosmetic' ? disableOtherCosmetics(rec)
          : [];
      installer.setEnabled(rec.files, enabled, rec.id);
      library.setEnabled(id, enabled);
      if (touchesSchema(rec)) schemaService.refresh();
      return { ok: true, replaced };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  /* Removing a selection is not the same as removing one mod N times.
   *
   * Every removal that touches the item table rebuilds the whole schema: the game's own
   * 50 MB table read out of its pak, twenty-five thousand items spliced, a VPK built and
   * written. That only has to be right once, at the end, so thirty mods used to pay for it
   * thirty times - which is what made deleting a Skinchanger import feel like the app had
   * hung. Deleting the files themselves was never the slow part: that is about two
   * milliseconds each.
   */
  ipcMain.handle('mods:removeMany', (e, ids) => {
    const errors = [];
    let removed = 0;
    let schemaTouched = false;
    for (const id of Array.isArray(ids) ? ids : []) {
      const rec = library.find(id);
      if (!rec) continue;
      try {
        if (rec.kind === 'pack') installer.removePackFully(rec);
        else installer.remove(rec.files, { recId: rec.id, deployed: rec.enabled !== false });
        library.removeRecord(id);
        if (touchesSchema(rec)) schemaTouched = true;
        removed++;
      } catch (err) {
        errors.push(`${rec.name}: ${String(err.message || err)}`);
      }
    }
    if (schemaTouched) schemaService.refresh();
    return { ok: true, removed, errors };
  });

  // Same bargain for switching a selection on or off: one rebuild for the batch, not one
  // per mod. Cursors and cosmetics are left out because only one of each can be live and
  // the screen never offers them here.
  ipcMain.handle('mods:setEnabledMany', (e, ids, enabled) => {
    const errors = [];
    let changed = 0;
    let schemaTouched = false;
    for (const id of Array.isArray(ids) ? ids : []) {
      const rec = library.find(id);
      if (!rec || rec.enabled === !!enabled) continue;
      try {
        installer.setEnabled(rec.files, !!enabled, rec.id);
        library.setEnabled(id, !!enabled);
        if (touchesSchema(rec)) schemaTouched = true;
        changed++;
      } catch (err) {
        errors.push(`${rec.name}: ${String(err.message || err)}`);
      }
    }
    if (schemaTouched) schemaService.refresh();
    return { ok: true, changed, errors };
  });

  /* Who owns the map archive already sitting in the language folder.
   *
   * A terrain and a Minify map mod are the same file - maps/dota.vpk - because that is the
   * name Dota reads. There is no slot to reserve and no way to keep both: installing one
   * replaces the other. So the app asks this before it writes, and says whose work is about
   * to go, rather than replacing it and letting the user find out in a match.
   *
   * Ours by the library, Minify's by the marker it packs into what it builds, and everything
   * else unknown - a terrain installed by hand is somebody's too.
   */
  ipcMain.handle('mods:mapsOwner', () => {
    try {
      const dir = path.join(installer.langFolder(), 'maps');
      if (!fs.existsSync(dir)) return { present: false };
      const known = new Set(library.knownLangRelPaths().map((r) => String(r).replace(/\\/g, '/').toLowerCase()));
      let unknown = null;
      for (const f of fs.readdirSync(dir)) {
        if (!/\.vpk$/i.test(f)) continue;
        if (known.has(`maps/${f}`.toLowerCase())) continue;   // ours: replacing it is ordinary
        if (isMinifyPak(path.join(dir, f))) return { present: true, owner: 'minify', file: f };
        unknown = unknown || f;
      }
      return unknown ? { present: true, owner: 'unknown', file: unknown } : { present: false };
    } catch {
      return { present: false };
    }
  });

  ipcMain.handle('mods:remove', (e, id) => {
    const rec = library.find(id);
    if (!rec) return { error: t('Мод не найден') };
    try {
      if (rec.kind === 'pack') installer.removePackFully(rec);
      else installer.remove(rec.files, { recId: rec.id, deployed: rec.enabled !== false });
      library.removeRecord(id);
      if (touchesSchema(rec)) schemaService.refresh();
      return { ok: true };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  /**
   * Move a mod one step through the load order. The game mounts pakNN_dir.vpk in numeric
   * order and the first copy of a file wins, so the pak number IS the priority - stepping
   * up means trading slots with the mod directly above.
   *
   * This is the whole ordering story now. The app used to work out who covered whom by
   * comparing what every mod ships and then offer to fix it, which was wrong often enough
   * to be worse than useless: mods that merely share a stock file are not fighting, and no
   * amount of filtering told the two cases apart reliably. Which mod wins is a decision
   * only the person looking at the game can make.
   */
  /* The load order has two parts (installer.js, PRIORITY_SLOTS): the categories that load first,
   * then everything else. A mod moves among its own part only, so "load earlier" on the first
   * mod after the shaders stops there instead of trading slots with a shader. */
  const orderOf = (rec) => library.list()
    .filter((r) => installer.zoneFor(r.categoryId) === installer.zoneFor(rec.categoryId))
    .map((r) => ({ r, n: installer.slotNumber(r) }))
    .filter((x) => x.n != null)
    .sort((a, b) => a.n - b.n);

  ipcMain.handle('mods:move', (e, id, dir) => {
    const rec = library.find(id);
    if (!rec) return { error: t('Мод не найден') };
    try {
      const ordered = orderOf(rec);
      const at = ordered.findIndex((x) => x.r.id === id);
      if (at === -1) return { error: t('У мода нет слота pakNN') };
      const to = at + (dir < 0 ? -1 : 1);
      if (to < 0 || to >= ordered.length) return { ok: true, moved: 0 };
      const other = ordered[to].r;
      for (const m of installer.swapSlots(rec, other)) library.update(m.id, { files: m.files });
      return { ok: true, moved: 1, with: other.name };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  /**
   * Put a mod at a given place in the load order.
   *
   * The arrows moved a mod one slot per press, which is fine for a nudge and absurd for the
   * thing people actually want: a mod that has to load before thirty others took thirty
   * presses. Dragging asks for a destination instead, and this walks the mod there.
   *
   * It walks with the same swap the arrows use rather than renumbering everything itself.
   * A slot is a file name on disk, so every one of these steps renames real files in the
   * game folder, and reusing the operation that has been doing that safely is worth more
   * than saving a few renames. The order is re-read after each step because the swap is what
   * changes it.
   */
  ipcMain.handle('mods:reorder', (e, id, toIndex) => {
    const rec = library.find(id);
    if (!rec) return { error: t('Мод не найден') };
    // toIndex counts the whole list, as the screen shows it; the walk stays inside the mod's part
    const all = () => library.list()
      .map((r) => ({ r, n: installer.slotNumber(r) }))
      .filter((x) => x.n != null)
      .sort((a, b) => a.n - b.n);
    const orderNow = () => orderOf(rec);
    try {
      let ordered = orderNow();
      let at = ordered.findIndex((x) => x.r.id === id);
      if (at === -1) return { error: t('У мода нет слота pakNN') };
      const target = all()[Math.max(0, Math.min(all().length - 1, Math.trunc(Number(toIndex))))];
      // a place in the other part means as far as this part goes in that direction
      const inPart = target ? ordered.findIndex((x) => x.r.id === target.r.id) : -1;
      const to = inPart !== -1 ? inPart
        : Math.trunc(Number(toIndex)) < all().findIndex((x) => x.r.id === id) ? 0 : ordered.length - 1;
      let steps = 0;
      while (at !== to && steps <= ordered.length) {
        const step = to > at ? 1 : -1;
        for (const m of installer.swapSlots(ordered[at].r, ordered[at + step].r)) {
          library.update(m.id, { files: m.files });
        }
        ordered = orderNow();
        at = ordered.findIndex((x) => x.r.id === id);
        steps++;
      }
      return { ok: true, moved: steps };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

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
      return { error: String(err.message || err) };
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
      return { error: String(err.message || err) };
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
      return { error: String(err.message || err) };
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
    const fields = { name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel || null };
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

      const { fingerprintVpk, readVpkIndexFile } = require('./vpk');
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
      return { error: String(err.message || err) };
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
      return { error: String(err.message || err) };
    }
  });

  // adopt a foreign cursor set (resource\cursor) recognised as a catalog mod
  ipcMain.handle('mods:adoptCursor', (e, preview) => {
    try {
      const cursorDir = path.join(installer.getGamePath(), 'dota', 'resource', 'cursor');
      if (!fs.existsSync(cursorDir)) return { error: t('Папка курсора не найдена') };
      const files = [];
      const rels = [];
      const walk = (d, pre) => {
        // the entry type comes with the listing: no stat before the read (js/file-system-race)
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          const rel = pre ? `${pre}/${e.name}` : e.name;
          if (e.isDirectory()) walk(full, rel);
          else if (e.isFile()) { files.push({ path: e.name.toLowerCase(), data: fs.readFileSync(full) }); rels.push(rel); }
        }
      };
      walk(cursorDir, '');
      const { fingerprintFiles } = require('./vpk');
      const matches = fingerprints.match(fingerprintFiles(files));
      if (!matches) return { error: t('Совпадение с каталогом не найдено') };
      const m = matches[0];
      const rec = library.add({ name: m.name, categoryId: m.categoryId, styleLabel: m.styleLabel || null, fileRef: m.name, preview: preview || null, files: rels.map((rp) => ({ root: 'cursor', relPath: rp })) });
      // the set is on disk but not ours yet — keep a copy so it can be switched off and on
      try { installer.ensureCursorStore(rec.id, rec.files); } catch { /* noop */ }
      return { ok: true, name: m.name };
    } catch (err) {
      return { error: String(err.message || err) };
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
      return { error: String(err.message || err) };
    }
  });
}

module.exports = { registerLibraryIpc };

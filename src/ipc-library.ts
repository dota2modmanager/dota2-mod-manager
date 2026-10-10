/* Managing mods that are already installed: the master switch, one mod's switch, load order,
 * and removal one at a time and in batches. Files somebody put in the folder by hand are
 * src/ipc-foreign.ts.
 *
 * What the channels reach for is a list at the top of the function instead of whatever the
 * enclosing file happened to have in scope.
 */
import fs from 'node:fs';
import path from 'node:path';

import { t } from './i18n.ts';
import { isMinifyPak } from './minify.ts';
import { touchesSchema } from './presets-service.ts';
import { electron } from './electron.ts';
import { errorText } from './error-text.ts';
import { FileTx } from './file-tx.ts';
import type { AppContext } from './app-context.ts';
import type { LibRecord } from './types.ts';

/** Register this module's channels, over the services and callbacks src/main.ts hands it. */
export function registerLibraryIpc({
  applyMasterToCursors, disableOtherCosmetics, disableOtherCursors,
  installer, isCursorRecord, library, refreshPresence, schemaService,
}: Pick<AppContext, 'applyMasterToCursors' | 'disableOtherCosmetics' | 'disableOtherCursors' | 'installer' | 'isCursorRecord' | 'library' | 'refreshPresence' | 'schemaService'>): void {
  const { ipcMain } = electron();
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
      return { error: errorText(err) };
    }
  });

  /** A mod's files and its record go together, or neither does. */
  const removeOne = (rec: LibRecord) => FileTx.run(() => {
    if (rec.kind === 'pack') installer.removePackFully(rec);
    else installer.remove(rec.files, { recId: rec.id, deployed: rec.enabled !== false });
    library.removeRecord(rec.id);
  }, installer.log);

  ipcMain.handle('mods:setEnabled', (e, id, enabled) => {
    const rec = library.find(id);
    if (!rec) return { error: t('Мод не найден') };
    try {
      // One change: the other set switched off, this one on, and both records. A failure on the
      // last rename leaves the folder and the library as they were, not the old set off and the
      // new one still off too.
      const replaced = FileTx.run(() => {
        // only one cursor set — and only one look per cosmetic slot — can be live at a time
        const others = enabled && isCursorRecord(rec) ? disableOtherCursors(id)
          : enabled && rec.categoryId === 'cosmetic' ? disableOtherCosmetics(rec)
            : [];
        installer.setEnabled(rec.files, enabled, rec.id);
        library.setEnabled(id, enabled);
        return others;
      }, installer.log);
      if (touchesSchema(rec)) schemaService.refresh();
      return { ok: true, replaced };
    } catch (err) {
      return { error: errorText(err) };
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
    const errors: string[] = [];
    let removed = 0;
    let schemaTouched = false;
    for (const id of Array.isArray(ids) ? ids : []) {
      const rec = library.find(id);
      if (!rec) continue;
      try {
        removeOne(rec);
        if (touchesSchema(rec)) schemaTouched = true;
        removed++;
      } catch (err) {
        errors.push(`${rec.name}: ${errorText(err)}`);
      }
    }
    if (schemaTouched) schemaService.refresh();
    return { ok: true, removed, errors };
  });

  // Same bargain for switching a selection on or off: one rebuild for the batch, not one
  // per mod. Cursors and cosmetics are left out because only one of each can be live and
  // the screen never offers them here.
  ipcMain.handle('mods:setEnabledMany', (e, ids, enabled) => {
    const errors: string[] = [];
    let changed = 0;
    let schemaTouched = false;
    for (const id of Array.isArray(ids) ? ids : []) {
      const rec = library.find(id);
      if (!rec || rec.enabled === !!enabled) continue;
      try {
        FileTx.run(() => {
          installer.setEnabled(rec.files, !!enabled, rec.id);
          library.setEnabled(id, !!enabled);
        }, installer.log);
        if (touchesSchema(rec)) schemaTouched = true;
        changed++;
      } catch (err) {
        errors.push(`${rec.name}: ${errorText(err)}`);
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
      removeOne(rec);
      if (touchesSchema(rec)) schemaService.refresh();
      return { ok: true };
    } catch (err) {
      return { error: errorText(err) };
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
  /* The load order has two parts (src/slot-zones.ts, PRIORITY_SLOTS): the categories that load first,
   * then everything else. A mod moves among its own part only, so "load earlier" on the first
   * mod after the shaders stops there instead of trading slots with a shader. */
  // mods that hold a pakNN slot, by that number; a mod without one is not in the order at all
  const numbered = (list: LibRecord[]) => list
    .map((r) => ({ r, n: installer.slotNumber(r) }))
    .filter((x): x is { r: LibRecord; n: number } => x.n != null)
    .sort((a, b) => a.n - b.n);
  const orderOf = (rec: LibRecord) => numbered(library.list()
    .filter((r) => installer.zoneFor(r.categoryId) === installer.zoneFor(rec.categoryId)));

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
      FileTx.run(() => {
        for (const m of installer.swapSlots(rec, other)) library.update(m.id, { files: m.files });
      }, installer.log);
      return { ok: true, moved: 1, with: other.name };
    } catch (err) {
      return { error: errorText(err) };
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
    const all = () => numbered(library.list());
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
      // the whole walk is one change: a refusal on the tenth swap does not leave the mod halfway
      const steps = FileTx.run(() => {
        let n = 0;
        while (at !== to && n <= ordered.length) {
          const step = to > at ? 1 : -1;
          for (const m of installer.swapSlots(ordered[at].r, ordered[at + step].r)) {
            library.update(m.id, { files: m.files });
          }
          ordered = orderNow();
          at = ordered.findIndex((x) => x.r.id === id);
          n++;
        }
        return n;
      }, installer.log);
      return { ok: true, moved: steps };
    } catch (err) {
      return { error: errorText(err) };
    }
  });

}

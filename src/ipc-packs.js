/* Combined packs: several mods merged into one pak slot, and taken apart again.
 *
 * A pack is one archive built out of several, so it holds a member list of its own and every
 * change to it means rebuilding and redeploying that archive. Bodies unchanged from main.js.
 */
const fs = require('fs');
const crypto = require('crypto');
const { ipcMain } = require('electron');

const { t } = require('./i18n.ts');
const { packableRecord } = require('./presets-service.ts');

/** @param {object} ctx  the services and main-process callbacks these channels use */
function registerPacksIpc({
  afterDeployMaster, deployAndApply, installer, library,
}) {

  // Combine any mix of standalone mods and existing packs into one pack. Packs are
  // absorbed by moving their stored member VPKs into the target pack, so two packs (or a
  // pack + mods) are effectively taken apart and rebuilt together into a single slot.
  ipcMain.handle('packs:combine', (e, payload) => {
    try {
      const recs = (payload.modIds || []).map((id) => library.find(id)).filter(Boolean);
      const packs = recs.filter((r) => r.kind === 'pack');
      const mods = recs.filter((r) => packableRecord(r));
      const totalMembers = packs.reduce((n, p) => n + (p.members ? p.members.length : 0), 0) + mods.length;
      if (totalMembers < 2) return { error: t('Выбери минимум 2 мода (или пак и мод / два пака)') };

      // reuse the first selected pack as the target (absorb the rest into it), else new
      let target = packs[0];
      const otherPacks = packs.slice(1);
      if (!target) {
        target = library.add({
          name: (payload.name && payload.name.trim()) || t('Пак ({0})', totalMembers),
          categoryId: 'combined', styleLabel: null, fileRef: null, preview: null, files: [], kind: 'pack', members: [],
        });
      } else if (payload.name && payload.name.trim()) {
        target.name = payload.name.trim();
      }
      fs.mkdirSync(installer.packFolder(target.id), { recursive: true });

      // standalone mods -> new members (their own deployment is removed)
      for (const r of mods) {
        target.members.push(installer.addPackMemberFromRecord(target.id, r, crypto.randomUUID()));
        try { installer.remove(r.files); } catch { /* noop */ }
        library.removeRecord(r.id);
      }
      // other packs -> move each stored member VPK into the target, then delete the pack
      for (const p of otherPacks) {
        for (const m of p.members || []) {
          const src = installer.packMemberFile(p.id, m.id);
          if (!fs.existsSync(src)) continue;
          const newId = crypto.randomUUID();
          fs.renameSync(src, installer.packMemberFile(target.id, newId));
          target.members.push({ ...m, id: newId });
        }
        installer.removePackFully(p);
        library.removeRecord(p.id);
      }
      const conflicts = deployAndApply(target);
      return { ok: true, pack: library.find(target.id), conflicts };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  // Add more library mods into an existing pack.
  ipcMain.handle('packs:addMembers', (e, packId, modIds) => {
    const pack = library.find(packId);
    if (!pack || pack.kind !== 'pack') return { error: t('Пак не найден') };
    try {
      const recs = (modIds || []).map((id) => library.find(id)).filter(packableRecord);
      if (!recs.length) return { error: t('Нет совместимых модов для добавления') };
      for (const r of recs) {
        pack.members.push(installer.addPackMemberFromRecord(pack.id, r, crypto.randomUUID()));
        try { installer.remove(r.files); } catch { /* noop */ }
        library.removeRecord(r.id);
      }
      const conflicts = deployAndApply(pack);
      return { ok: true, pack: library.find(pack.id), added: recs.length, conflicts };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  // Enable/disable one member inside a pack (rebuilds the merged VPK from enabled members).
  ipcMain.handle('packs:setMemberEnabled', (e, packId, memberId, enabled) => {
    const pack = library.find(packId);
    if (!pack || pack.kind !== 'pack') return { error: t('Пак не найден') };
    const m = (pack.members || []).find((x) => x.id === memberId);
    if (!m) return { error: t('Мод в паке не найден') };
    try {
      m.enabled = !!enabled;
      const conflicts = deployAndApply(pack);
      return { ok: true, conflicts };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  // Remove one member from a pack. If it was the last one, the pack itself is removed.
  ipcMain.handle('packs:removeMember', (e, packId, memberId) => {
    const pack = library.find(packId);
    if (!pack || pack.kind !== 'pack') return { error: t('Пак не найден') };
    const idx = (pack.members || []).findIndex((x) => x.id === memberId);
    if (idx < 0) return { error: t('Мод в паке не найден') };
    try {
      try { fs.rmSync(installer.packMemberFile(pack.id, pack.members[idx].id), { force: true }); } catch { /* noop */ }
      pack.members.splice(idx, 1);
      if (!pack.members.length) {
        installer.removePackFully(pack);
        library.removeRecord(pack.id);
        return { ok: true, removedPack: true };
      }
      deployAndApply(pack);
      return { ok: true };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  // Extract selected members out of a pack back into standalone deployed mods, keeping the
  // rest of the pack intact (removes the pack entirely if nothing is left).
  ipcMain.handle('packs:extractMembers', (e, packId, memberIds) => {
    const pack = library.find(packId);
    if (!pack || pack.kind !== 'pack') return { error: t('Пак не найден') };
    try {
      const ids = new Set(memberIds || []);
      const names = [];
      for (const m of (pack.members || []).filter((x) => ids.has(x.id))) {
        const { files } = installer.deployMemberAsMod(pack, m);
        const rec = library.add({ name: m.name, categoryId: m.categoryId || 'imported', styleLabel: m.styleLabel || null, fileRef: pack.name, preview: m.preview || null, files });
        if (m.enabled === false) { try { installer.setEnabled(files, false); } catch { /* noop */ } library.setEnabled(rec.id, false); }
        try { fs.rmSync(installer.packMemberFile(pack.id, m.id), { force: true }); } catch { /* noop */ }
        names.push(m.name);
      }
      pack.members = (pack.members || []).filter((x) => !ids.has(x.id));
      if (!pack.members.length) {
        installer.removePackFully(pack);
        library.removeRecord(pack.id);
        afterDeployMaster();
        return { ok: true, count: names.length, names, removedPack: true };
      }
      deployAndApply(pack);
      return { ok: true, count: names.length, names };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });

  // Disband a pack back into standalone mods (one deployed pak per member).
  ipcMain.handle('packs:disband', (e, packId) => {
    const pack = library.find(packId);
    if (!pack || pack.kind !== 'pack') return { error: t('Пак не найден') };
    try {
      const names = [];
      for (const m of pack.members || []) {
        const { files } = installer.deployMemberAsMod(pack, m);
        const rec = library.add({ name: m.name, categoryId: m.categoryId || 'imported', styleLabel: m.styleLabel || null, fileRef: pack.name, preview: m.preview || null, files });
        if (m.enabled === false) { try { installer.setEnabled(files, false); } catch { /* noop */ } library.setEnabled(rec.id, false); }
        names.push(m.name);
      }
      installer.removePackFully(pack);
      library.removeRecord(pack.id);
      afterDeployMaster();
      return { ok: true, count: names.length, names };
    } catch (err) {
      return { error: String(err.message || err) };
    }
  });
}

module.exports = { registerPacksIpc };

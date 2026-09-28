/* What My mods can ask for (library/model.ts, LibraryActions): the ticks, the search, the switches,
 * the bulk bar, the banners and the foreign files. What a single row's menu does is in
 * record-actions.ts. */
import { isCursorRec, isCosmeticRec, isFontRec, isPackableRec } from '../../core/records.ts';
import { toast } from '../../ui/toast.ts';
import { confirmDialog } from '../../ui/dialog.ts';
import { catalogPreviewFor } from '../../ui/thumb.ts';
import { isMemberKey, memberOf, selectableCosmetics, selectableMods } from '../../library/selection.ts';
import type { LibraryActions } from '../../library/model.ts';
import { external } from './external.ts';
import { handleImportResult } from './import.ts';
import { pickModsDialog } from './pick-mods.ts';
import { combineSelection, deleteRecord, menuFor, standalonePackable } from './record-actions.ts';
import { lib, recById, screen } from './state.ts';

const tick = (ids: string[], on: boolean) => { for (const id of ids) { if (on) lib.sel.add(id); else lib.sel.delete(id); } screen.draw(); };

// adopt every recognised mod at once, installed records and foreign files alike; one run at a
// time, since a second press while the first works would link the same files twice
let adopting = false;
async function adoptAll() {
  if (adopting) return;
  const recs = lib.records.filter((r) => r.match);
  // a foreign file that is a copy of an installed mod would land as a second row for the same thing
  const exts = lib.external.filter((f) => f.match && !f.duplicateOf);
  if (!recs.length && !exts.length) return;
  adopting = true;
  try {
    for (const r of recs) await window.api.mods.adoptMod(r.id, catalogPreviewFor(r.match));
    for (const f of exts) {
      const prev = catalogPreviewFor(f.match);
      if (f.kind === 'cursor') await window.api.mods.adoptCursor(prev);
      else if (f.kind === 'font') await window.api.mods.adoptFont(f.name, prev);
      else await window.api.mods.adoptExternal(f.key, prev);
    }
    toast(L`Привязано: ${recs.length + exts.length}`, 'ok');
    await screen.reload();
  } finally {
    adopting = false;
  }
}

/* "Включить все" and "Выключить все" over the mods. Cosmetics answer to their own section head:
 * only one look per slot can be live, so this over them would be a race the last one wins. */
async function enableAll(enabled: boolean) {
  const ids = lib.records.filter((rec) => !isFontRec(rec) && !isCosmeticRec(rec) && rec.enabled !== enabled).map((rec) => rec.id);
  if (ids.length) {
    const r = await window.api.mods.setEnabledMany(ids, enabled);
    if (r.errors?.length) toast(r.errors[0], 'error', 6000);
  }
  await screen.reload();
}

/** Exactly the ticked ones, mods and mods inside packs alike. */
async function setTicked(enabled: boolean) {
  const keys = [...lib.sel];
  if (!keys.length) return;
  for (const k of keys) {
    if (isMemberKey(k)) {
      const { packId, memberId } = memberOf(k);
      await window.api.packs.setMemberEnabled(packId, memberId, enabled);
    } else {
      const rec = recById(k);
      if (!rec || isFontRec(rec)) continue;
      if (rec.enabled !== enabled) await window.api.mods.setEnabled(k, enabled);
    }
  }
  toast(enabled ? L`Включено` : L`Выключено`);
  await screen.reload();
}

async function removeTicked() {
  const keys = [...lib.sel];
  if (!keys.length || !await confirmDialog(L`Удалить выбранное (${keys.length})?`)) return;
  // members belong to a pack and each one rebuilds it, so those stay one at a time; everything
  // else goes in a single call and pays for the schema rebuild once
  for (const k of keys.filter(isMemberKey)) {
    const { packId, memberId } = memberOf(k);
    await window.api.packs.removeMember(packId, memberId);
  }
  const mods = keys.filter((k) => !isMemberKey(k));
  const r = mods.length ? await window.api.mods.removeMany(mods) : { errors: [] };
  lib.sel.clear();
  if (r.errors?.length) toast(r.errors[0], 'error', 6000);
  else toast(L`Удалено`);
  await screen.reload();
}

/** The ticked mods inside packs out of them, one rebuild per pack. */
async function extractTicked() {
  const byPack = new Map<string, string[]>();
  for (const k of lib.sel) {
    if (!isMemberKey(k)) continue;
    const { packId, memberId } = memberOf(k);
    byPack.set(packId, [...(byPack.get(packId) || []), memberId]);
  }
  if (!byPack.size) return;
  let total = 0;
  for (const [packId, memberIds] of byPack) {
    const r = await window.api.packs.extractMembers(packId, memberIds);
    if (r.error) { toast(r.error, 'error', 6000); continue; }
    total += r.count || 0;
  }
  lib.sel.clear();
  toast(L`Вытащено из пака: ${total}`, 'ok');
  await screen.reload();
}

async function adoptTicked() {
  const recs = [...lib.sel].filter((k) => !isMemberKey(k)).map(recById).filter((r) => r && r.match);
  if (!recs.length) return;
  for (const r of recs) if (r) await window.api.mods.adoptMod(r.id, catalogPreviewFor(r.match));
  lib.sel.clear();
  toast(L`Привязано: ${recs.length}`, 'ok');
  await screen.reload();
}

function combineTicked() {
  // a pak holds VPK content; a cursor set is loose files elsewhere in the game and stays out
  const tops = [...lib.sel].filter((k) => !isMemberKey(k));
  if (tops.some((k) => isCursorRec(recById(k)))) toast(L`Курсоры в пак не входят — они лежат не в паках, а в resource\\cursor`, 'warn', 6000);
  combineSelection(tops.filter((k) => { const r = recById(k); return r && (isPackableRec(r) || r.kind === 'pack'); }));
}

async function banner(what: string, data?: string) {
  if (what === 'adoptAll') return adoptAll();
  if (what === 'combine') {
    const ids = await pickModsDialog(standalonePackable(), { title: L`Выбери моды для объединения в пак`, okLabel: L`Далее` });
    if (ids) await combineSelection(ids);
    return;
  }
  if (what === 'reinstallStuck') {
    for (const { id } of lib.stuck) {
      const rec = recById(id);
      if (!rec) continue;
      const r = await window.api.mods.install({ categoryId: rec.categoryId, name: rec.name, styleLabel: rec.styleLabel, fileRef: rec.fileRef, preview: rec.preview });
      if (r.error) toast(`${rec.name}: ${r.error}`, 'error', 6000);
    }
  } else if (what === 'repairNow') {
    // "I closed the game, try again": the same repair the app runs on its own, on demand
    lib.repair = await window.api.patch.repairNow();
    if (lib.repair.state === 'waiting') toast(L`Dota всё ещё запущена — закрой её полностью`, 'warn', 6000);
  } else if (what === 'repairSeen') {
    lib.repair = await window.api.patch.repairSeen();
  } else if (what === 'moveFrom') {
    const r = await window.api.settings.moveLangFiles(data);
    if (r?.error) toast(r.error, 'error');
    else toast(L`Перенесено файлов: ${r.moved}`, 'ok');
  }
  await screen.reload();
}

export const actions: LibraryActions = {
  search: (q) => { lib.search = q; screen.draw(); },
  select: (key, on) => tick([key], on),
  selectAll: (on) => tick(selectableMods(lib.records, lib.search), on),
  selectAllCosmetics: (on) => tick(selectableCosmetics(lib.records, lib.search), on),
  clearSelection: () => { lib.sel.clear(); screen.draw(); },
  expand: (id) => {
    if (lib.open.has(id)) lib.open.delete(id); else lib.open.add(id);
    screen.draw();
  },
  toggle: async (id) => {
    const rec = recById(id);
    if (!rec) return;
    const r = await window.api.mods.setEnabled(rec.id, !rec.enabled);
    if (r.error) toast(r.error, 'error', 6000);
    // a cursor that goes on takes the place of the one that was on
    else if (r.replaced?.length) toast(L`Курсор заменён — «${r.replaced.join(', ')}» выключен`, 'warn', 6000);
    await screen.reload();
  },
  toggleMember: async (packId, memberId) => {
    const m = recById(packId)?.members?.find((x) => x.id === memberId);
    const r = await window.api.packs.setMemberEnabled(packId, memberId, !(m && m.enabled));
    if (r.error) toast(r.error, 'error', 6000);
    await screen.reload();
  },
  removeMember: async (packId, memberId) => {
    const m = recById(packId)?.members?.find((x) => x.id === memberId);
    if (!await confirmDialog(L`Убрать «${m?.name || tr('мод')}» из пака?`, { okLabel: L`Убрать` })) return;
    const r = await window.api.packs.removeMember(packId, memberId);
    if (r.error) toast(r.error, 'error', 6000);
    else if (r.removedPack) toast(L`Пак удалён — в нём не осталось модов`);
    else toast(L`Убрано из пака`);
    await screen.reload();
  },
  remove: (id) => { deleteRecord(id); },
  adopt: async (id) => {
    const rec = recById(id);
    const r = await window.api.mods.adoptMod(id, catalogPreviewFor(rec && rec.match));
    if (r.error) toast(r.error, 'error', 6000);
    else toast(L`Привязан к каталогу: «${r.name}»`, 'ok');
    await screen.reload();
  },
  menu: menuFor,
  reorder: async (id, to) => {
    const res = await window.api.mods.reorder(id, to);
    if (res?.error) toast(res.error, 'error', 6000);
    await screen.reload();
  },
  banner,
  enableAll: (on) => { enableAll(on); },
  disableCosmetics: async () => {
    const cos = lib.records.filter((r) => isCosmeticRec(r) && r.enabled !== false);
    if (!cos.length) return;
    for (const rec of cos) await window.api.mods.setEnabled(rec.id, false);
    toast(L`Косметика выключена — слоты снова как в игре`);
    await screen.reload();
  },
  importFiles: async () => { await handleImportResult(await window.api.mods.importDialog()); },
  importFolder: async () => { await handleImportResult(await window.api.mods.importFolderDialog()); },
  bulk: (what) => {
    if (what === 'enable' || what === 'disable') setTicked(what === 'enable');
    else if (what === 'remove') removeTicked();
    else if (what === 'extract') extractTicked();
    else if (what === 'adopt') adoptTicked();
    else combineTicked();
  },
  external,
  noticeRead: () => { screen.reload(); },
};

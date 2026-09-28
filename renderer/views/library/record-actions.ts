/* What one row can do, as functions rather than click handlers, because the row and its
 * right-click menu both need them. Each ends by reading main again: the load order, the pack a mod
 * sits in and what is on disk are things a neighbouring row can be showing too.
 *
 * What the row does not print lives in the menu. The load order, exporting a mod as one file and
 * taking a multi-hero mod apart are all real and all rare: on the row they were three buttons every
 * mod carried so that a few could use them. */
import { catName } from '../../core/categories.ts';
import { isCursorRec, isPackableRec } from '../../core/records.ts';
import { fmtMB, plural } from '../../ui/format.ts';
import { toast } from '../../ui/toast.ts';
import { confirmDialog, promptDialog } from '../../ui/dialog.ts';
import type { MenuItem } from '../../ui/menu.ts';
import type { LibRecord } from '../../library/types.ts';
import { pickModsDialog, type Candidate } from './pick-mods.ts';
import { lib, recById, screen } from './state.ts';

async function moveRecord(id: string, dir: number) {
  const r = await window.api.mods.move(id, dir);
  if (r.error) toast(r.error, 'error', 6000);
  await screen.reload();
}

async function exportRecord(id: string) {
  const rec = recById(id);
  if (!rec) return;
  toast(L`Собираю «${rec.name}» в один файл…`);
  const r = await window.api.mods.exportSingle(id);
  if (r.error) toast(`${rec.name}: ${r.error}`, 'error', 6000);
  else if (r.ok) toast(L`${rec.name} сохранён одним файлом (${fmtMB(r.size)} MB)`, 'ok', 6000);
}

/* Hand the mod's own files back as a tree. The pair to dropping a folder in: a mod can be opened,
 * one texture changed, and the folder dropped back without any other tool. */
async function unpackRecord(id: string) {
  const rec = recById(id);
  if (!rec) return;
  const r = await window.api.mods.unpackToFolder(id);
  if (r.cancelled) return;
  if (r.error) toast(`${rec.name}: ${r.error}`, 'error', 6000);
  else if (r.ok) toast(L`«${rec.name}»: распакован, файлов — ${r.files} (${fmtMB(r.bytes)} MB)`, 'ok', 6000);
}

async function splitRecord(id: string) {
  const rec = recById(id);
  if (!rec) return;
  if (!await confirmDialog(
    L`Разбить «${rec.name}» на отдельные моды по героям? Исходный файл заменится на отдельные, каждый можно будет включать и удалять по отдельности.`,
    { okLabel: L`Разобрать` },
  )) return;
  const r = await window.api.mods.splitMod(id);
  if (r.error) toast(r.error, 'error', 6000);
  else toast(L`Разобрано на ${r.count}: ${r.names.join(', ')}`, 'ok', 6000);
  await screen.reload();
}

/** Standalone mods that can go into a pack. */
export function standalonePackable(): Candidate[] {
  return lib.records.filter(isPackableRec).map((r) => ({
    id: r.id, name: r.name + (r.styleLabel ? ` (${r.styleLabel})` : ''), sub: r.info || catName(r.categoryId),
  }));
}

async function addToPack(id: string) {
  const ids = await pickModsDialog(standalonePackable(), { title: L`Добавить моды в пак`, okLabel: L`Добавить` });
  if (!ids) return;
  const r = await window.api.packs.addMembers(id, ids);
  if (r.error) toast(r.error, 'error', 6000);
  else toast(L`Добавлено в пак: ${r.added}`);
  await screen.reload();
}

async function disbandPack(id: string) {
  const rec = recById(id);
  if (!rec) return;
  if (!await confirmDialog(L`Разобрать пак «${rec.name}» на отдельные моды? Каждый мод снова займёт свой слот.`, { okLabel: L`Разобрать` })) return;
  const r = await window.api.packs.disband(id);
  if (r.error) toast(r.error, 'error', 6000);
  else toast(L`Разобрано на ${r.count}: ${r.names.slice(0, 4).join(', ')}${r.names.length > 4 ? '…' : ''}`, 'ok', 6000);
  await screen.reload();
}

export async function deleteRecord(id: string): Promise<void> {
  const rec = recById(id);
  if (!rec) return;
  if (!await confirmDialog(rec.kind === 'pack' ? L`Удалить пак «${rec.name}» со всеми модами внутри?` : L`Удалить «${rec.name}»?`)) return;
  const r = await window.api.mods.remove(id);
  if (r.error) toast(r.error, 'error');
  else toast(L`${rec.name} удалён`);
  await screen.reload();
}

/** Several standalone mods and packs made into one pack. */
export async function combineSelection(ids: string[] | null): Promise<void> {
  if (!ids || ids.length < 2) { toast(L`Выбери минимум 2 элемента`, 'warn'); return; }
  const existing = lib.records.find((r) => ids.includes(r.id) && r.kind === 'pack');
  const name = await promptDialog(existing ? L`Название объединённого пака:` : L`Название пака:`, {
    placeholder: L`напр. «Анимешный сет»`, value: existing ? existing.name : '', okLabel: L`Объединить`,
  });
  if (name === null) return;
  const r = await window.api.packs.combine(name, ids);
  if (r.error) { toast(r.error, 'error', 6000); return; }
  lib.sel.clear();
  const n = (r.pack.members || []).length;
  toast(L`Пак «${r.pack.name}»: ${n} ${plural(n, 'мод', 'мода', 'модов')}`, 'ok', 6000);
  if (r.conflicts?.length) toast(L`Пересечения файлов: ${r.conflicts.length} (победил тот, что раньше в паке)`, 'warn', 6000);
  await screen.reload();
}

const langDir = (rec: LibRecord) => (rec.files || []).some((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));

/* The load order is on offer for every mod, not only the ones the app thinks are in conflict:
 * which files actually cover which is a call for the person looking at the game. */
function orderItems(rec: LibRecord): (MenuItem | false)[] {
  const place = lib.order.get(rec.id);
  if (!place) return [];
  return [
    { label: L`Загружать раньше`, icon: 'keyboard_arrow_up', disabled: place.zoneFirst, onPick: () => moveRecord(rec.id, -1) },
    { label: L`Загружать позже`, icon: 'keyboard_arrow_down', disabled: place.zoneLast, onPick: () => moveRecord(rec.id, 1) },
  ];
}

export function menuFor(id: string): MenuItem[] | null {
  const rec = recById(id);
  if (!rec) return null;
  const ordered = lib.order.has(rec.id);
  const remove: MenuItem = { label: L`Удалить`, icon: 'delete', danger: true, onPick: () => deleteRecord(rec.id) };
  const items: (MenuItem | false | undefined)[] = rec.kind === 'pack' ? [
    // same rule as a mod row: the switch and the delete are on the row, the rest is here
    { label: L`Добавить моды в пак`, icon: 'add', onPick: () => addToPack(rec.id) },
    { label: L`Разобрать на отдельные моды`, icon: 'call_split', onPick: () => disbandPack(rec.id) },
    langDir(rec) && { label: L`Сохранить одним файлом`, icon: 'save', onPick: () => exportRecord(rec.id) },
    ordered && { separator: true },
    ...orderItems(rec),
    { separator: true },
    remove,
  ] : [
    ...orderItems(rec),
    ordered && { separator: true },
    (isCursorRec(rec) || langDir(rec)) && {
      label: isCursorRec(rec) ? L`Сохранить курсор архивом` : L`Сохранить одним файлом`, icon: 'save', onPick: () => exportRecord(rec.id),
    },
    langDir(rec) && { label: L`Распаковать в папку`, icon: 'folder_open', onPick: () => unpackRecord(rec.id) },
    (rec.subjects || 0) >= 2 && { label: L`Разобрать по героям`, icon: 'call_split', onPick: () => splitRecord(rec.id) },
    { separator: true },
    remove,
  ];
  return items.filter((x): x is MenuItem => Boolean(x));
}

/* What one row can do, as functions rather than click handlers, because the row and its
 * right-click menu both need them. Each ends by reading main again: the load order, the pack a mod
 * sits in and what is on disk are things a neighbouring row can be showing too.
 *
 * What the row does not print lives in the menu. The load order, exporting a mod as one file and
 * taking a multi-hero mod apart are all real and all rare: on the row they were three buttons every
 * mod carried so that a few could use them. */
import { catalogName, catalogLabel } from '../../ui/catalog-name.ts';
import { catName } from '../../core/categories.ts';
import { isCursorRec, isPackableRec } from '../../core/records.ts';
import { fmtMB, plural } from '../../ui/format.ts';
import { toast } from '../../ui/toast.ts';
import { confirmDialog, promptDialog } from '../../ui/dialog.ts';
import type { MenuItem } from '../../ui/menu.ts';
import type { LibRecord } from '../../library/types.ts';
import { pickModsDialog, type Candidate } from './pick-mods.ts';
import { recolorFromLibrary } from '../catalog/arcana.ts';
import { mapLooksFromLibrary } from '../catalog/map-looks.ts';
import { soundsFromLibrary } from '../catalog/sounds.ts';
import { abilityIconsFromLibrary } from '../catalog/ability-icons.ts';
import { backgroundFromLibrary } from '../catalog/background.ts';
import { hudFromLibrary } from '../catalog/hud.ts';
import { rankFromLibrary } from '../catalog/rank.ts';
import { labelFor, recLabelKey } from '../../library/labels.ts';
import { askLabel, clearLabel } from './label.ts';
import { lib, recById, screen } from './state.ts';

async function moveRecord(id: string, dir: number) {
  const r = await window.api.mods.move(id, dir);
  if (r.error) toast(r.error, 'error', 6000);
  else lib.moved = id;
  await screen.reload();
}

async function exportRecord(id: string) {
  const rec = recById(id);
  if (!rec) return;
  toast(L`Собираю «${catalogName(rec.name)}» в один файл…`);
  const r = await window.api.mods.exportSingle(id);
  if (r.error) toast(`${catalogName(rec.name)}: ${r.error}`, 'error', 6000);
  else if (r.ok) toast(L`${catalogName(rec.name)} сохранён одним файлом (${fmtMB(r.size)} MB)`, 'ok', 6000);
}

/* Hand the mod's own files back as a tree. The pair to dropping a folder in: a mod can be opened,
 * one texture changed, and the folder dropped back without any other tool. */
async function unpackRecord(id: string) {
  const rec = recById(id);
  if (!rec) return;
  const r = await window.api.mods.unpackToFolder(id);
  if (r.cancelled) return;
  if (r.error) toast(`${catalogName(rec.name)}: ${r.error}`, 'error', 6000);
  else if (r.ok) toast(L`«${catalogName(rec.name)}»: распакован, файлов — ${r.files} (${fmtMB(r.bytes)} MB)`, 'ok', 6000);
}

async function splitRecord(id: string) {
  const rec = recById(id);
  if (!rec) return;
  if (!await confirmDialog(
    L`Разбить «${catalogName(rec.name)}» на отдельные моды по героям? Исходный файл заменится на отдельные, каждый можно будет включать и удалять по отдельности.`,
    { okLabel: L`Разобрать` },
  )) return;
  const r = await window.api.mods.splitMod(id);
  if (r.error) toast(r.error, 'error', 6000);
  else toast(L`Разобрано на ${r.count}: ${r.names.map(n => catalogName(n)).join(', ')}`, 'ok', 6000);
  await screen.reload();
}

/* A hero mod's Blink Dagger and other item pictures taken out of it: they show on every hero, and
 * the person wanted the hero (Discord, 2026-11-11). For good: an update takes them out again. */
async function dropItemIcons(id: string) {
  const rec = recById(id);
  if (!rec) return;
  if (!await confirmDialog(
    L`Убрать из «${catalogName(rec.name)}» иконки предметов? Блинк, БКБ и другие предметы снова будут с обычными картинками на всех героях. Вернуть их можно, только поставив мод заново.`,
    { okLabel: L`Убрать` },
  )) return;
  const r = await window.api.mods.dropItemIcons(id);
  if (r.error) toast(r.error, 'error', 6000);
  else if (!r.dropped) toast(L`В этом моде нет иконок предметов`, 'warn');
  else toast(L`«${catalogName(rec.name)}»: убрано иконок предметов: ${r.dropped}`, 'ok', 6000);
  await screen.reload();
}

/** Standalone mods that can go into a pack. */
export function standalonePackable(): Candidate[] {
  return lib.records.filter(isPackableRec).map((r) => ({
    id: r.id, name: catalogName(r.name) + (r.styleLabel ? ` (${catalogLabel(r.styleLabel)})` : ''), sub: r.info || catName(r.categoryId),
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
  if (!await confirmDialog(L`Разобрать пак «${catalogName(rec.name)}» на отдельные моды? Каждый мод снова займёт свой слот.`, { okLabel: L`Разобрать` })) return;
  const r = await window.api.packs.disband(id);
  if (r.error) toast(r.error, 'error', 6000);
  else toast(L`Разобрано на ${r.count}: ${r.names.slice(0, 4).map(n => catalogName(n)).join(', ')}${r.names.length > 4 ? '…' : ''}`, 'ok', 6000);
  await screen.reload();
}

export async function deleteRecord(id: string): Promise<void> {
  const rec = recById(id);
  if (!rec) return;
  if (!await confirmDialog(rec.kind === 'pack' ? L`Удалить пак «${catalogName(rec.name)}» со всеми модами внутри?` : L`Удалить «${catalogName(rec.name)}»?`)) return;
  const r = await window.api.mods.remove(id);
  if (r.error) toast(r.error, 'error');
  else toast(L`${catalogName(rec.name)} удалён`);
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

/* The catalog's new version of a mod, in its own slot and with its own switch (src/mod-update.ts).
 * The download shows on the bar at the bottom like an install. */
export async function updateRecord(id: string): Promise<boolean> {
  const rec = recById(id);
  if (!rec) return false;
  const r = await window.api.mods.update(id);
  if (r.error) { toast(`${catalogName(rec.name)}: ${r.error}`, 'error', 6000); return false; }
  toast(L`«${catalogName(rec.name)}» обновлён`, 'ok');
  return true;
}

/* The pre-patch mark off one mod: whoever owns it looked in the game and it works. A later patch
 * that reaches it again puts the mark back. */
async function clearPrePatch(id: string) {
  const r = await window.api.mods.clearPrePatch(id);
  if (r.error) toast(r.error, 'error', 6000);
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
  const gen = rec.generated as { set?: string; map?: string; sounds?: string; abilityIcons?: string; background?: string; hud?: number; rank?: object } | undefined;
  const remove: MenuItem = { label: L`Удалить`, icon: 'delete', danger: true, onPick: () => deleteRecord(rec.id) };
  const key = recLabelKey(rec.id);
  const naming: (MenuItem | false)[] = [
    { label: L`Подписать`, icon: 'edit', onPick: () => askLabel(key, catalogName(rec.name)) },
    Boolean(labelFor(key)) && { label: L`Убрать подпись`, icon: 'label_off', onPick: () => clearLabel(key) },
  ];
  const items: (MenuItem | false | undefined)[] = rec.kind === 'pack' ? [
    // same rule as a mod row: the switch and the delete are on the row, the rest is here
    { label: L`Добавить моды в пак`, icon: 'add', onPick: () => addToPack(rec.id) },
    { label: L`Разобрать на отдельные моды`, icon: 'call_split', onPick: () => disbandPack(rec.id) },
    langDir(rec) && { label: L`Сохранить одним файлом`, icon: 'save', onPick: () => exportRecord(rec.id) },
    ...naming,
    ordered && { separator: true },
    ...orderItems(rec),
    { separator: true },
    remove,
  ] : [
    rec.updateAvailable && { label: L`Обновить до новой версии`, icon: 'upgrade', onPick: async () => { await updateRecord(rec.id); await screen.reload(); } },
    rec.updateAvailable && { separator: true },
    // what the app built: another colour or look is chosen in its window, not here
    Boolean(gen?.set) && { label: L`Перекрасить`, icon: 'palette', onPick: () => void recolorFromLibrary(String(gen?.set)) },
    Boolean(gen?.sounds) && { label: L`Изменить звуки`, icon: 'graphic_eq', onPick: () => void soundsFromLibrary(String(gen?.sounds)) },
    Boolean(gen?.abilityIcons) && { label: L`Изменить иконки`, icon: 'imagesmode', onPick: () => void abilityIconsFromLibrary(String(gen?.abilityIcons)) },
    Boolean(gen?.background) && { label: L`Изменить фон`, icon: 'wallpaper', onPick: () => void backgroundFromLibrary() },
    typeof gen?.hud === 'number' && { label: L`Изменить размер`, icon: 'aspect_ratio', onPick: () => void hudFromLibrary() },
    Boolean(gen?.rank) && { label: L`Изменить ранг и уровни`, icon: 'military_tech', onPick: () => void rankFromLibrary() },
    Boolean(gen?.map) && { label: L`Изменить вид`, icon: 'tune', onPick: () => void mapLooksFromLibrary(gen?.map === 'trees' ? 'trees' : 'towers') },
    Boolean(rec.generated) && { separator: true },
    ...orderItems(rec),
    ordered && { separator: true },
    (isCursorRec(rec) || langDir(rec)) && {
      label: isCursorRec(rec) ? L`Сохранить курсор архивом` : L`Сохранить одним файлом`, icon: 'save', onPick: () => exportRecord(rec.id),
    },
    langDir(rec) && { label: L`Распаковать в папку`, icon: 'folder_open', onPick: () => unpackRecord(rec.id) },
    (rec.subjects || 0) >= 2 && { label: L`Разобрать по героям`, icon: 'call_split', onPick: () => splitRecord(rec.id) },
    langDir(rec) && !rec.noItemIcons && rec.categoryId !== 'item-icons' && { label: L`Убрать иконки предметов`, icon: 'hide_image', onPick: () => dropItemIcons(rec.id) },
    rec.prePatch && { label: L`Убрать метку «до патча»`, icon: 'done', onPick: () => clearPrePatch(rec.id) },
    ...naming,
    { separator: true },
    remove,
  ];
  return items.filter((x): x is MenuItem => Boolean(x));
}

/* A My mods row as the components draw it (library/model.ts), out of a record from main. */
import { COSMETIC_PREFIX } from '../../core/constants.ts';
import { matchLabel } from '../../core/installed.ts';
import { catName, catIcon } from '../../core/categories.ts';
import { isCursorRec, isFontRec, isCosmeticRec, effectNames } from '../../core/records.ts';
import { staleTerrainWhy } from '../../core/terrain-age.ts';
import { fmtMB } from '../../ui/format.js';
import { isVideo } from '../../ui/media.js';
import { recPreviewUrl } from '../../ui/thumb.js';
import { extThumb, recThumb } from '../../library/thumbs.ts';
import { memberKey } from '../../library/selection.ts';
import { pakFileName } from '../../library/order.ts';
import type { ExternalRowModel, PackRowModel, RowModel, Tag } from '../../library/model.ts';
import type { Cover, ExternalFile, LibRecord, Member } from '../../library/types.ts';
import { lib } from './state.ts';

/* Mods that carry item-schema changes: their model installs like any other, but the effects and
 * icons only exist once the schema patch is on. Say which of the two it is. */
function schemaTag(rec: LibRecord): Tag | null {
  if (!rec.schemaCount) return null;
  return rec.schemaLive
    ? { cls: 'schema', icon: 'auto_awesome', text: L`эффекты`, title: L`Мод меняет схему предметов: его эффекты и иконки собраны в общую таблицу` }
    : { cls: 'schema off', icon: 'error', text: L`нужны правки`, title: L`Мод меняет схему предметов. Без правок схемы встанет только модель — эффекты и иконки работать не будут.` };
}

/* Installed, switched on, and still not the one the game loads: two mods carry the same file and
 * the one loaded first wins it. The fix is the load order, which right-click offers. */
function coveredTag(x: { coveredBy?: Cover[]; enabled: boolean }): Tag | null {
  const by = x.coveredBy;
  if (!by || !by.length || !x.enabled) return null;
  const total = by.reduce((n, c) => n + c.files, 0);
  const who = by.map((c) => `«${c.name}» (${c.files})`).join(', ');
  return { cls: 'covered', icon: 'layers', text: L`перекрыт`,
    title: L`Файлов перекрыто: ${total} — ${who}. Побеждает мод, который загружается раньше; порядок меняется правой кнопкой.` };
}

const known = <T>(list: (T | null)[]): T[] => list.filter((x): x is T => x !== null);

export function modRow(rec: LibRecord, index: number): RowModel {
  const cosmetic = isCosmeticRec(rec);
  const place = lib.order.get(rec.id);
  return {
    kind: 'mod',
    id: rec.id,
    name: rec.name,
    styleLabel: rec.styleLabel || null,
    enabled: rec.enabled,
    selected: lib.sel.has(rec.id),
    selectable: !isFontRec(rec),
    order: place ? place.index : null,
    index,
    thumb: cosmetic ? { icon: null } : recThumb(rec),
    cosmetic: cosmetic ? { name: rec.name, icon: catIcon(COSMETIC_PREFIX + rec.slot) } : null,
    tags: known([
      rec.match ? { cls: 'match', text: matchLabel(rec.match) } : rec.info ? { cls: '', text: rec.info } : null,
      schemaTag(rec),
      coveredTag(rec),
      rec.staleMap ? { cls: 'stale', icon: 'history', text: L`старая карта`, title: staleTerrainWhy() } : null,
    ]),
    meta: cosmetic ? catName(COSMETIC_PREFIX + rec.slot) + effectNames(rec) : catName(rec.categoryId),
    pakFile: pakFileName(rec),
    toggle: isFontRec(rec) ? null : {
      title: isCursorRec(rec) ? L`Курсор в игре может быть только один — этот выключит остальные`
        : cosmetic ? L`На один слот — только один активный вид` : null,
    },
    adoptable: Boolean(rec.match),
  };
}

export function packRow(rec: LibRecord, index: number): PackRowModel {
  const members = rec.members || [];
  const place = lib.order.get(rec.id);
  // four empty boxes say nothing a single "several heroes in one" stand-in would not say better
  let cells: PackRowModel['cells'] = null;
  if (members.some((m) => recPreviewUrl(m))) {
    const four: NonNullable<PackRowModel['cells']> = members.slice(0, 4).map((m) => {
      const p = recPreviewUrl(m);
      return p ? { url: p, video: isVideo(p) } : { icon: catIcon(m.categoryId) };
    });
    while (four.length < 4) four.push(null);
    cells = four;
  }
  return {
    kind: 'pack',
    id: rec.id,
    name: rec.name,
    enabled: rec.enabled,
    selected: lib.sel.has(rec.id),
    open: lib.open.has(rec.id),
    order: place ? place.index : null,
    index,
    cells,
    standIn: { key: 'generic:pack', icon: 'auto_awesome' },
    onCount: members.filter((m) => m.enabled).length,
    pakFile: pakFileName(rec),
    members: members.map((m) => ({
      key: memberKey(rec.id, m.id),
      id: m.id,
      name: m.name,
      styleLabel: m.styleLabel || null,
      enabled: m.enabled,
      selected: lib.sel.has(memberKey(rec.id, m.id)),
      meta: m.info || catName(m.categoryId),
      thumb: recThumb(m),
    })),
  };
}

export function externalRow(f: ExternalFile): ExternalRowModel {
  const simple = f.kind === 'cursor' || f.kind === 'font'; // whole-folder sets: adopted, never switched
  const name = f.kind === 'cursor' ? L`Курсор в игре` : f.name;
  const label: Tag | null = f.duplicateOf
    ? { cls: 'dup', icon: 'content_copy', text: L`копия`, title: L`Тот же файл уже стоит как «${f.duplicateOf}» — эта копия лишняя` }
    : f.match ? { cls: 'match', text: matchLabel(f.match) }
      : f.info ? { cls: '', text: f.info } : null;
  // what the row is, then where it lives: the file name is what the user sees in the folder
  const sub = f.kind === 'cursor' ? 'resource/cursor'
    : f.kind === 'font' ? L`шрифт · panorama/fonts`
      : f.duplicateOf ? L`копия «${f.duplicateOf}»`
        : f.match ? L`мод из каталога` : f.info ? L`опознан по содержимому` : L`внешний файл`;
  return {
    key: f.key,
    name,
    enabled: f.enabled,
    dup: Boolean(f.duplicateOf),
    thumb: extThumb(f),
    tags: known([label, coveredTag(f)]),
    fileName: !simple && f.fileName && f.fileName !== name ? f.fileName : null,
    size: simple ? null : `${fmtMB(f.size)} MB`,
    sub,
    simple,
    adopt: f.duplicateOf ? null : {
      title: f.match ? L`Привязать к каталогу и управлять как обычным модом` : L`Взять файл к себе — дальше как у обычного мода`,
    },
    splittable: (f.subjects || 0) >= 2,
  };
}

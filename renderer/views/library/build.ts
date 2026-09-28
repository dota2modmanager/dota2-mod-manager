/* The whole of My mods as library/LibraryScreen.tsx draws it, worked out from what was last read
 * from main (state.ts) and the store's settings and patch state. */
import { state } from '../../core/store.ts';
import { isCosmeticRec } from '../../core/records.ts';
import { minifyNotice } from '../../core/minify-notice.ts';
import { plural } from '../../ui/format.ts';
import { noticeBannerHtml } from '../../ui/notice.ts';
import { listParts } from '../../library/order.ts';
import { bulkOffer, selectableCosmetics, selectableMods, tristate } from '../../library/selection.ts';
import type { BannersModel, LibraryModel } from '../../library/model.ts';
import { externalRow, modRow, packRow } from './rows.ts';
import { lib } from './state.ts';

interface GameLang {
  mounted?: string;
  folder?: string;
  stranded?: { suffix: string; modFiles: number }[];
  launchLang?: string;
}

function banners(): BannersModel {
  const s = state.settings || {};
  const gl: GameLang = s.gameLang || {};
  const patch = (state.patchState || {}) as { conflicts?: { mods: string[] }[]; foreign?: string; vanillaOk?: boolean };
  const conflicts = patch.conflicts || [];
  const ourMods = lib.records.length;
  const note = minifyNotice(s.minify, ourMods);
  const lang = gl.launchLang;
  return {
    masterOff: state.masterOff,
    matched: lib.records.filter((r) => r.match).length + lib.external.filter((f) => f.match && !f.duplicateOf).length,
    nearLimit: lib.slots >= 90 ? { slots: lib.slots, ceil: lib.slotCeil } : null,
    conflicts: conflicts.length ? { lists: conflicts.slice(0, 3).map((c) => c.mods), more: Math.max(0, conflicts.length - 3) } : null,
    foreign: patch.foreign || null,
    vanillaBad: Boolean(state.patchState) && patch.vanillaOk === false,
    mounted: gl.mounted && gl.mounted !== gl.folder ? { mounted: gl.mounted, folder: gl.folder || '' } : null,
    stranded: gl.stranded || [],
    // followed: mods already go where the game reads, so this is news rather than trouble
    launchLang: lang ? { lang, followed: Boolean(gl.folder) && String(lang).toLowerCase() === String(gl.folder).toLowerCase() } : null,
    minify: note ? {
      case: note.case, kind: note.kind, folder: s.minify.folder, mounted: s.minify.mounted,
      ourFolder: s.minify.ourFolder, reservedLabel: s.minify.reservedLabel || null, ourMods,
    } : null,
    prelaunch: Boolean(s.minify?.prelaunch),
    stuck: lib.stuck.map((x) => x.name),
    repair: lib.repair,
  };
}

export function libraryModel(): LibraryModel {
  const all = lib.records;
  const { mods, cosmetics } = listParts(all, lib.search, lib.order);
  const enabled = all.filter((m) => m.enabled).length;
  const dupes = lib.external.filter((f) => f.duplicateOf).length;
  return {
    key: lib.key,
    noticeHtml: noticeBannerHtml(),
    banners: banners(),
    search: lib.search,
    stats: `${all.length} ${plural(all.length, 'мод', 'мода', 'модов')} · ${enabled} ${L`вкл`} · ${lib.slots}/${lib.slotCeil} ${plural(lib.slots, 'слот', 'слота', 'слотов')}`,
    listHead: all.some((r) => !isCosmeticRec(r)),
    masterOff: state.masterOff,
    empty: !all.length ? L`Пока ничего не установлено — загляни в Каталог`
      : !mods.length && !cosmetics.length ? L`Ничего не найдено по запросу` : null,
    rows: mods.map((rec, i) => (rec.kind === 'pack' ? packRow(rec, i) : modRow(rec, i))),
    cosmetics: cosmetics.length ? {
      rows: cosmetics.map((rec, i) => modRow(rec, i)),
      count: cosmetics.length,
      on: cosmetics.filter((r) => r.enabled !== false).length,
    } : null,
    selectAll: tristate(selectableMods(all, lib.search), lib.sel),
    selectAllCosmetics: tristate(selectableCosmetics(all, lib.search), lib.sel),
    external: lib.external.length ? { rows: lib.external.map(externalRow), dupes } : null,
    bulk: bulkOffer(lib.sel, all),
  };
}

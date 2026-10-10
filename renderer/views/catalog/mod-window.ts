/* A mod's window: what it shows (catalog/modal/ModModal.tsx draws it) and what its buttons do. It
 * opens on the look the card was showing, which is the one the user was just looking at. */
import { catalogName } from '../../ui/catalog-name.ts';
import { state } from '../../core/store.ts';
import { keyOf, refreshInstalledIndex } from '../../core/installed.ts';
import { catName, catIcon } from '../../core/categories.ts';
import { modCredits, isCreditRole } from '../../core/credits.ts';
import { creditChipsHtml, bindCreditChips } from '../../ui/credit-chips.ts';
import { fmtDate } from '../../ui/format.ts';
import { toast } from '../../ui/toast.ts';
import { confirmDialog } from '../../ui/dialog.ts';
import { previewUrl, isMedia, resolveUrl } from '../../ui/media.ts';
import { openPlayer } from '../../ui/player.ts';
import { modGuidesHtml, bindGuides } from '../../ui/guide.ts';
import { isFav, toggleFavorite } from '../../catalog/favorites.ts';
import { styleIndex, pickStyle, isInstalled } from '../../catalog/looks.ts';
import { playablePreview } from '../../catalog/preview.ts';
import { redrawScreen } from '../../catalog/screen/root.tsx';
import { showModModal } from '../../catalog/modal/root.tsx';
import type { ModModalModel } from '../../catalog/modal/model.ts';
import type { Mod } from '../../catalog/types.ts';
import { customPacks, saveCustomPacks } from './lists.ts';
import { doInstall, installPack, onInstalling, packMemberName } from './install.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { installing, screen } from './state.ts';

interface ModWindow {
  categoryId: string;
  mod: Mod;
  styleIdx: number;
  /** a pack's members dropped for this install */
  packExcluded: Set<string>;
}

let open: ModWindow | null = null;
sharesOverlay(() => { open = null; });
onInstalling(() => { if (open) drawModal(); });

export function openModWindow(categoryId: string, mod: Mod, from: Element | null): void {
  takeOverlay();
  open = { categoryId, mod, styleIdx: styleIndex(categoryId, mod), packExcluded: new Set() };
  openOverlay(drawModal, from);
}

const LINK_LABEL: Record<string, string> = {
  preview: 'Превью', source: 'Источник', author: 'Автор', bug: 'Баг', guide: 'Гайд',
  'source-code': 'Исходники',
};

function packMembers(mod: Mod): { name: string; hit: { categoryId: string; mod: Mod } | undefined }[] {
  return (mod.mods || [])
    .map(packMemberName)
    .filter(Boolean)
    .map((name) => ({ name, hit: state.modIndex.get(name.toLowerCase()) }));
}

const NOTE: Record<string, () => string> = {
  fonts: () => L`Шрифт ставится в файлы игры (game\\dota\\panorama\\fonts) — параметр запуска не нужен. Оригиналы сохраняются автоматически.`,
  cursors: () => L`Курсор ставится в game\\dota\\resource\\cursor — параметр запуска не нужен. Оригиналы сохраняются автоматически. Включать и выключать его можно в «Моих модах», но активным может быть только один курсор: новый выключит предыдущий.`,
};

function drawModal(): void {
  const st = open;
  if (!st) return;
  const { categoryId, mod, styleIdx } = st;
  const styles = mod.styles || null;
  const style = styles ? styles[styleIdx] : null;
  const fileRef = style ? style.file : mod.file;
  const target = fileRef && /\.(vpk|zip)$/i.test(fileRef) ? fileRef : null;
  const isPack = mod.type === 'pack';
  const styleLabel = style ? style.label : null;
  const preview = style?.preview || mod.preview;
  const installedRec = state.installedIndex.get(keyOf(categoryId, mod.name, styleLabel));
  const links = mod.links || [];
  // everybody the catalog credits, not only the first author (core/credits.ts says why)
  const credits = modCredits(mod, state.catalog?.constants);
  // people are credits above, not buttons: their "url" is a name, which opened as a 404
  const otherLinks = links.filter((l) => !(l.type === 'preview' && isMedia(l.url)) && !isCreditRole(l.type));
  const members = isPack ? packMembers(mod) : [];
  const excluded = st.packExcluded;
  const playable = playablePreview(mod);
  const redraw = () => drawModal();

  const model: ModModalModel = {
    categoryId,
    catName: catName(categoryId),
    mod,
    styles,
    styleIdx,
    mediaUrl: previewUrl(categoryId, preview),
    fallbackIcon: catIcon(categoryId),
    playable,
    fav: isFav(categoryId, mod.name),
    date: mod.meta?.date ? fmtDate(mod.meta.date) : null,
    creditsHtml: creditChipsHtml(credits),
    kind: categoryId === 'tools' ? 'tool' : isPack ? 'pack' : 'mod',
    target,
    installedId: installedRec?.id ?? null,
    toolRelPath: installedRec?.files?.[0]?.relPath || '',
    busy: installing.has(keyOf(categoryId, mod.name, styleLabel)),
    pack: isPack ? {
      members: members.map((x) => ({
        name: x.name,
        thumb: x.hit ? previewUrl(x.hit.categoryId, x.hit.mod.preview || x.hit.mod.styles?.[0]?.preview) : null,
        catName: x.hit ? catName(x.hit.categoryId) : null,
        installed: Boolean(x.hit && isInstalled(x.hit.categoryId, x.hit.mod)),
        excluded: excluded.has(x.name),
      })),
      activeCount: members.filter((x) => !excluded.has(x.name)).length,
      custom: Boolean(mod._custom),
    } : null,
    guidesHtml: modGuidesHtml(mod),
    links: otherLinks.map((l) => ({ index: links.indexOf(l), label: tr(LINK_LABEL[l.type || ''] || l.type || 'Ссылка') })),
    note: NOTE[categoryId]?.() ?? null,
  };

  showModModal(model, {
    close: closeOverlay,
    toggleFav: async () => {
      await toggleFavorite(categoryId, mod.name);
      redraw();
      redrawScreen(); // the card behind the window wears the same heart
      screen.favChanged();
    },
    playPreview: () => { if (playable) openPlayer(playable, catalogName(mod.name)); },
    pickStyle: (i) => {
      st.styleIdx = i;
      // the card behind the window is showing a look too; they agree from here on
      pickStyle(categoryId, mod, i);
      redrawScreen();
      redraw();
    },
    togglePackMember: (name) => {
      if (excluded.has(name)) excluded.delete(name);
      else excluded.add(name);
      redraw();
    },
    savePack: (name) => savePack(mod, name, members.filter((x) => !excluded.has(x.name)).map((x) => x.name)),
    deletePack: async () => {
      if (!await confirmDialog(L`Удалить пак «${catalogName(mod.name)}»?`)) return;
      saveCustomPacks(customPacks().filter((p) => p.name !== mod.name));
      closeOverlay();
      screen.redraw();
    },
    install: () => {
      if (!isPack) { doInstall(categoryId, mod, styleLabel, fileRef, preview); return; }
      closeOverlay();
      installPack(mod, excluded);
    },
    uninstall: async () => {
      if (!installedRec || !await confirmDialog(L`Удалить «${catalogName(mod.name)}»?`)) return;
      const r = await window.api.mods.remove(installedRec.id);
      if (r.error) toast(r.error, 'error');
      else toast(L`${catalogName(mod.name)} удалён`);
      await refreshInstalledIndex();
      redrawScreen();
      redraw();
    },
    runTool: async () => {
      const r = await window.api.misc.runTool(model.toolRelPath);
      if (r.error) toast(r.error, 'error');
    },
    openToolFolder: () => window.api.misc.openToolsFolder(model.toolRelPath),
    openLink: () => window.api.misc.openExternal(mod.file),
    openExtraLink: (index) => {
      const u = resolveUrl(links[index].url);
      if (u) window.api.misc.openExternal(u);
    },
    bindCredits: (el) => bindCreditChips(el, credits, (url: string) => window.api.misc.openExternal(url)),
    bindGuides: (el) => bindGuides(el),
  });
}

/** Keep a pack as the user trimmed it: a new one under its name, or theirs rewritten. */
function savePack(mod: Mod, name: string, modNames: string[]): void {
  if (!name) { toast(L`Введи название пака`, 'warn'); return; }
  if (!modNames.length) { toast(L`В паке не осталось модов`, 'warn'); return; }
  const packs = customPacks().filter((p) => p.name !== name && p.name !== (mod._custom ? mod.name : null));
  packs.push({ name, mods: modNames });
  saveCustomPacks(packs);
  toast(L`Пак «${name}» сохранён — он появился в категории Паки`);
  if (state.view === 'catalog' && state.activeCategory === 'packs') { closeOverlay(); screen.redraw(); }
}

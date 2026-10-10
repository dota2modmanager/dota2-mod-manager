/* Free looks taken from the game's own item schema, browsed as a catalog category like any other:
 * a look's window (catalog/cosmetic/CosmeticModal.tsx draws it) and the pick itself. A hero's item
 * opens the item builder's window instead (views/item-builder.ts). */
import { COSMETIC_PREFIX, cosmeticMeta } from '../../core/constants.ts';
import { state } from '../../core/store.ts';
import { pickedIn, refreshInstalledIndex } from '../../core/installed.ts';
import { toast } from '../../ui/toast.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import { loadCosmeticIcons, cosmeticIconKnown } from '../../ui/cosmetic-icons.ts';
import { favKey, isFav, toggleFavorite } from '../../catalog/favorites.ts';
import { redrawScreen } from '../../catalog/screen/root.tsx';
import { showCosmeticModal } from '../../catalog/modal/root.tsx';
import type { CosmeticOption } from '../../catalog/types.ts';
import { openItemSlotModal, redrawItemSlotModal } from '../item-builder.ts';
import { refreshItemHub } from '../item-hub.ts';
import { cosmeticFavValue, findCosmetic, isItemCosmeticSlot, slotData, type Look } from './lists.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { installing, screen } from './state.ts';

let open: Look | null = null;
sharesOverlay(() => { open = null; });

export function openCosmeticWindow(slot: string, itemId: string, from: Element | null): void {
  const o = findCosmetic(slot, itemId);
  if (!o) return;
  // a hero's item, found by the search or in favourites: the builder's window, with it typed in
  if (isItemCosmeticSlot(slot)) { openItemSlotModal(slot, from, { query: o.name }); return; }
  takeOverlay();
  open = { slot, o };
  openOverlay(drawCosmeticModal, from);
  // the picture may not have been fetched yet if the card was never scrolled into view
  if (!cosmeticIconKnown(o.name)) loadCosmeticIcons([o.name], () => { if (open?.o === o) drawCosmeticModal(); });
}

function drawCosmeticModal(): void {
  if (!open) return;
  const { slot, o } = open;
  const meta = cosmeticMeta(slot);
  const data = slotData(slot);
  const live = pickedIn(slot);
  const cat = COSMETIC_PREFIX + slot;
  const value = cosmeticFavValue(slot, o);
  showCosmeticModal({
    slot,
    id: o.id,
    name: o.name,
    fallbackIcon: meta.icon,
    label: tr(meta.label),
    options: data ? data.options.length : null,
    favKey: favKey(cat, value),
    fav: isFav(cat, value),
    live: live?.itemId === o.id,
    replaces: live && live.itemId !== o.id ? live.name : null,
    busy: installing.has(COSMETIC_PREFIX + slot + '|' + o.id + '|'),
    blocked: !state.settings?.schemaPatch,
  }, {
    close: closeOverlay,
    toggleFav: async () => {
      await toggleFavorite(cat, value);
      drawCosmeticModal();
      redrawScreen();
      screen.favChanged();
    },
    pick: () => pickCosmetic(slot, o, false),
    remove: () => pickCosmetic(slot, o, true),
  });
}

/**
 * Put a look on (or take the live one off) and repaint whatever is on screen.
 * @param remove  true = back to what the game gives
 * @param effectId  the effects on a hero's item, comma separated (src/item-builder.ts effectKey)
 */
export async function pickCosmetic(slot: string, o: CosmeticOption, remove: boolean, effectId = ''): Promise<void> {
  if (!remove && !state.settings?.schemaPatch) return;
  const effect = isItemCosmeticSlot(slot) ? String(effectId || '') : '';
  const k = COSMETIC_PREFIX + slot + '|' + o.id + '|' + effect;
  if (installing.has(k)) return;
  const live = pickedIn(slot);
  installing.add(k);
  if (open) drawCosmeticModal();
  let r: { ok?: boolean; error?: string };
  try {
    r = remove
      ? (live ? await window.api.mods.remove(live.id) : { ok: true })
      : await window.api.cosmetics.pick(slot, o.id, o.name, effect);
  } catch (err) {
    r = { error: String((err as Error)?.message || err) };
  }
  installing.delete(k);
  if (r.error) { toast(r.error, 'error'); if (open) drawCosmeticModal(); redrawItemSlotModal(); return; }
  toast(remove ? L`Вернули как в игре` : isItemCosmeticSlot(slot) ? L`Надето: ${cosmeticName(o.name)}` : L`Выбрано: ${cosmeticName(o.name)}`);
  await afterCosmeticPick();
}

/** Everything a pick shows on: My mods' index, the badges, the rail's dot, the open window. */
export async function afterCosmeticPick(): Promise<void> {
  await refreshInstalledIndex();
  redrawScreen(); // the live look is marked on whatever screen is on show, drawn again in place
  if (state.view === 'catalog') screen.rail(); // the slot's "picked" dot
  await refreshItemHub();
  if (open) drawCosmeticModal();
  redrawItemSlotModal();
}

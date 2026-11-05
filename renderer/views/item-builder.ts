/* The item builder in the catalog: a hero's items, each built from one of its wearables with an
 * effect on top. The hub lists heroes, and a hero opens its window (views/item-hero.ts): its slots,
 * its sets, and here what one slot offers, its wearables and the effects on top. What a pick does to the game is src/item-builder.ts; this
 * is the screen.
 *
 * Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
 * (https://github.com/TheFleece).
 * Copyright (C) 2026 h6rd
 * Copyright (C) 2026 TheFleece
 * SPDX-License-Identifier: GPL-3.0-or-later
 * The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
 * the credits of the program it goes into.
 *
 * It lives beside the catalog rather than inside it: it reads the slots and the toolbar's state
 * from views/catalog/, opens its windows in the overlay the catalog's share, and gets the pick
 * itself through bindItemBuilder. It keeps what is chosen and works out what each window shows;
 * catalog/builder/ draws it, and catalog/builder/logic.ts holds the rules.
 */
import { state } from '../core/store.ts';
import { pickedIn } from '../core/installed.ts';
import { byName, effectGroup, effectKey, effectPicture, liveDonor, liveEffects, liveStyle, rarityName, stagedItemAction, type EffectGroup } from '../catalog/builder/logic.ts';
import { cosmeticName } from '../ui/cosmetic-name.ts';
import { loadCosmeticIcons } from '../ui/cosmetic-icons.ts';
import { cosmeticSlotList, slotData } from './catalog/lists.ts';
import { openOverlay, sharesOverlay, takeOverlay } from './catalog/overlay.ts';
import type { CosmeticOption, CosmeticSet, CosmeticSlot } from '../catalog/types.ts';
import type { SlotPaneActions, SlotPaneModel, SlotView } from '../catalog/builder/model.ts';
import type { ScreenActions } from '../catalog/screen/model.ts';

/** What the catalog hands over, once, before anything here runs (views/catalog.ts). */
interface BuilderCtx {
  /** the pick itself (views/catalog/cosmetics.ts) */
  pickCosmetic: (slot: string, o: CosmeticOption, remove: boolean, effectId?: string) => Promise<void>;
  afterPick: () => Promise<void>;
  /** what the catalog's screen can ask for: the hub keeps all of it but its own filter */
  actions: ScreenActions;
}
let cat: BuilderCtx | null = null;

export function bindItemBuilder(ctx: BuilderCtx): void {
  cat = ctx;
}

const panel = () => document.getElementById('modalContent') as HTMLElement;


export function itemCosmeticSlots(): CosmeticSlot[] {
  return cosmeticSlotList().filter((s) => s.kind === 'item-effect' || String(s.slot || '').startsWith('item:'));
}

/** A hero's sets: none with a persona on, whose own items are all it wears (src/item-builder-personas.ts). */
export const heroSets = (heroName: string): CosmeticSet[] => (cosmeticSlotList().some((s) => s.heroLabel === heroName && s.persona && !s.persona.part && pickedIn(s.slot))
  ? [] : (state.cosmeticSets || []).filter((s) => s.heroLabel === heroName));

/* The hero's window on show (views/item-hero.ts). Each open counts up: the count is the window's
 * key, so opening draws it fresh (its cards play their entrance) and a change inside it updates in place. */
let opened = 0;
let redrawOpen: (() => void) | null = null;

/** Put a builder window on the overlay, the wide one. room: the hero's, as tall as the screen allows too,
 *  the same size whatever it shows; the recolour window (views/hero-paint.ts) is not. */
export function openWindow(from: Element | null, room: boolean, draw: (key: number) => void): void {
  takeOverlay(); // this lets go of the builder's own window too, so the key comes after
  const key = ++opened;
  redrawOpen = () => { if (isOpen(key)) draw(key); };
  openOverlay(() => {
    panel().classList.add('item-picker-modal');
    panel().classList.toggle('wardrobe-modal', room);
    draw(key);
  }, from);
}

/** Still the window on show: a pick that took a while may come back to a closed or different one. */
export const isOpen = (key: number): boolean => opened === key;

/** The pick itself, for the set windows (views/item-sets.ts). */
export const afterPick = (): Promise<void> => (cat ? cat.afterPick() : Promise.resolve());

/** What the catalog's screen can ask for, for the hub (views/item-hub.ts). */
export const catalogActions = (): ScreenActions => (cat as BuilderCtx).actions;

// ---------- a slot: its wearables, the effects on top, and the button that puts them on ----------

/** `donor`: the item of the slot whose effect the chosen one wears, '' for none (src/item-builder-donor.ts) */
export interface SlotState { slot: string; selectedId: string; effectIds: string[]; donor: string; style: number; query: string; view: SlotView; busy: boolean }

/**
 * What a slot's pane starts with: the item on, with its effects and style, unless `select` names another.
 * @param opts.query  typed into the search, for a card found by the catalog's search or in favourites
 * @param opts.select  the item chosen, for a piece opened from its set
 */
export function slotState(slot: string, { query = '', select = '' }: { query?: string; select?: string } = {}): SlotState {
  const live = pickedIn(slot);
  const selectedId = select || live?.itemId || '';
  const same = live?.itemId === selectedId;
  const data = slotData(slot);
  if (data) loadCosmeticIcons(data.options.slice(0, 36).map((o) => o.name).filter(Boolean), () => {}).catch(() => {});
  return { slot, selectedId, effectIds: same ? liveEffects(live) : [], donor: same ? liveDonor(live) : '', style: same ? liveStyle(live) : 0, query, view: 'items', busy: false };
}

/** An effect of the game's own (Ethereal Flame and the like), src/item-builder-unusual.ts. */
const GAME_EFFECT = /^unusual-\d+$/;
const GROUPS: EffectGroup[] = ['unusual', 'seasonal', 'courier'];

const facts = (o: { rarity?: string; date?: string }) => ({ rarity: o.rarity || '', rarityName: rarityName(o.rarity), year: (o.date || '').slice(0, 4) });

/** What a slot's pane shows and what its controls do; null for a slot the game no longer has. redraw: the window again. */
export function slotPane(st: SlotState, redraw: () => void): { m: SlotPaneModel; actions: SlotPaneActions } | null {
  const data = slotData(st.slot);
  if (!data) return null;
  const live = pickedIn(st.slot);
  const hasItem = !!st.selectedId;
  const effects = (data.effects || []).filter((fx) => fx.id);
  const chosen = hasItem ? data.options.find((o) => o.id === st.selectedId) : null;
  const styles = chosen?.styles && chosen.styles.length > 1 ? chosen.styles : null;
  // a tab with nothing to show for the item chosen falls back to the items
  if ((st.view === 'styles' && !styles) || (st.view !== 'items' && !hasItem)) st.view = 'items';
  // the slot's items with an effect of their own, the chosen one aside (issue #383)
  const donors = data.options.filter((o) => o.fx && o.id !== st.selectedId);
  const donor = hasItem && st.donor ? data.options.find((o) => o.id === st.donor) : null;
  const names = [...effects.filter((e) => st.effectIds.includes(e.id)).map((e) => e.name), ...(donor ? [L`эффект: ${cosmeticName(donor.name)}`] : []),
    ...(styles && st.style ? [styles[st.style]] : [])];
  const q = st.query.trim().toLowerCase();
  const fx = effects.filter((e) => !q || st.view !== 'effects' || e.name.toLowerCase().includes(q));
  const m: SlotPaneModel = {
    title: data.slotLabel || data.label || '',
    query: st.query,
    slotIcon: data.icon || 'checkroom',
    view: st.view,
    // the hero's own item first: choosing it is how a pick comes off
    options: byName([{ id: '', name: L`Стандартный`, tags: [] }, ...data.options], st.view === 'items' ? st.query : '').map((o) => ({
      id: o.id, name: o.name, picked: o.id === st.selectedId, on: o.id ? live?.itemId === o.id : !live, ...facts(o),
      ...('note' in o && o.note ? { note: o.note } : {}),
    })),
    optionsCount: data.options.length,
    styles: styles ? styles.map((name, index) => ({ index, name, picked: index === st.style })) : null,
    effects: effects.length ? {
      none: hasItem && !st.effectIds.length,
      enabled: hasItem,
      count: effects.length,
      picked: st.effectIds.length,
      // in each shelf the builder's own effects first, with their pictures, then the game's by name
      groups: GROUPS.map((group) => ({
        group,
        list: fx.filter((e) => effectGroup(e.id) === group)
          .sort((a, b) => Number(GAME_EFFECT.test(a.id)) - Number(GAME_EFFECT.test(b.id)) || (GAME_EFFECT.test(a.id) ? a.name.localeCompare(b.name) : 0))
          .map((e) => ({ id: e.id, name: e.name, picture: effectPicture(e.id), picked: hasItem && st.effectIds.includes(e.id) })),
      })).filter((g) => g.list.length),
    } : null,
    donors: donors.length ? {
      none: hasItem && !st.donor,
      list: byName(donors, st.view === 'donors' ? st.query : '').map((o) => ({ id: o.id, name: o.name, picked: hasItem && st.donor === o.id })),
      enabled: hasItem,
      count: donors.length,
    } : null,
    summary: { name: chosen ? chosen.name : L`Стандартный`, effects: chosen && names.length ? names.join(', ') : '' },
    action: stagedItemAction(data.effects, live, st),
  };
  return {
    m,
    actions: {
      view: (v) => { st.view = v; st.query = ''; redraw(); },
      search: (text) => { st.query = text; redraw(); },
      choose: (id) => {
        if (st.busy) return;
        st.selectedId = id;
        if (!id) st.effectIds = []; // the stock item takes no effects
        if (!id || id === st.donor) st.donor = '';
        // another item starts in its first style, or the one it is on in
        st.style = live?.itemId === id ? liveStyle(live) : 0;
        redraw();
      },
      style: (index) => {
        if (st.busy || !st.selectedId) return;
        st.style = index;
        redraw();
      },
      effect: (id) => {
        if (st.busy || !st.selectedId) return;
        st.effectIds = !id ? [] : st.effectIds.includes(id) ? st.effectIds.filter((x) => x !== id) : [...st.effectIds, id];
        redraw();
      },
      donor: (id) => {
        if (st.busy || !st.selectedId) return;
        st.donor = id === st.donor ? '' : id;
        redraw();
      },
      apply: () => void applySlot(st, chosen, redraw),
    },
  };
}

async function applySlot(st: SlotState, chosen: CosmeticOption | null | undefined, redraw: () => void): Promise<void> {
  const data = slotData(st.slot);
  if (!data || !cat) return;
  const act = stagedItemAction(data.effects, pickedIn(st.slot), st);
  // taking a pick off puts the stock item back, which has no id of its own
  const look = act.remove ? { id: '', name: L`Стандартный` } : chosen;
  if (act.off || !look) return;
  st.busy = true;
  redraw();
  try {
    await cat.pickCosmetic(st.slot, look, !!act.remove, effectKey(data.effects, st.effectIds, st.style, st.donor));
  } finally {
    st.busy = false;
    redraw();
  }
}

/** Take what is on a slot off, the stock item back (the hero window's "Снять"). */
export async function takeOff(slot: string): Promise<void> {
  if (cat) await cat.pickCosmetic(slot, { id: '', name: L`Стандартный` } as CosmeticOption, true);
}

/** Let go of the hero's window: another window is taking the overlay, or it closed. */
function forgetItemSlotModal() {
  opened++;
  redrawOpen = null;
  panel().classList.remove('item-picker-modal', 'wardrobe-modal');
}
sharesOverlay(forgetItemSlotModal);

/** Mark the open builder window again: what is on changed. */
export function redrawItemSlotModal(): void {
  redrawOpen?.();
}

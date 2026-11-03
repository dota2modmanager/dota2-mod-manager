/* The item builder in the catalog: a hero's items, each built from one of its wearables with an
 * effect on top. The hub lists heroes, a hero opens its item slots and its sets, and a slot opens
 * the picker of wearables and effects. What a pick does to the game is src/item-builder.ts; this
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
import { COSMETIC_PREFIX } from '../core/constants.ts';
import { catName } from '../core/categories.ts';
import { pickedIn } from '../core/installed.ts';
import { showSlotPicker, showHeroModal } from '../catalog/modal/root.tsx';
import { openPaint } from './hero-paint.ts';
import { byName, effectKey, effectPicture, heroesOf, liveDonor, liveEffects, liveStyle, setIsOn, stagedItemAction, tagLine } from '../catalog/builder/logic.ts';
import { plural } from '../ui/format.ts';
import { heroName } from '../ui/hero-name.ts';
import { cosmeticName } from '../ui/cosmetic-name.ts';
import { loadCosmeticIcons } from '../ui/cosmetic-icons.ts';
import { cosmeticSlotList, slotData } from './catalog/lists.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './catalog/overlay.ts';
import { openSets } from './item-sets.ts';
import type { CosmeticOption, CosmeticSet, CosmeticSlot } from '../catalog/types.ts';
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

const HUB = COSMETIC_PREFIX + 'items';

export function itemCosmeticSlots(): CosmeticSlot[] {
  return cosmeticSlotList().filter((s) => s.kind === 'item-effect' || String(s.slot || '').startsWith('item:'));
}

/** A hero's sets: none with a persona on, whose own items are all it wears (src/item-builder-personas.ts). */
export const heroSets = (heroName: string): CosmeticSet[] => (cosmeticSlotList().some((s) => s.heroLabel === heroName && s.persona && !s.persona.part && pickedIn(s.slot))
  ? [] : (state.cosmeticSets || []).filter((s) => s.heroLabel === heroName));

/* One builder window on show at a time. Each open counts up: the count is the window's key, so
 * opening draws it fresh (its cards play their entrance) and a change inside it updates in place. */
let opened = 0;
let redrawOpen: (() => void) | null = null;

/** Put a builder window on the overlay. wide: a picker, the wide one; the hero's own window is not. */
export function openWindow(from: Element | null, wide: boolean, draw: (key: number) => void): void {
  takeOverlay(); // this lets go of the builder's own window too, so the key comes after
  const key = ++opened;
  redrawOpen = () => { if (isOpen(key)) draw(key); };
  openOverlay(() => {
    panel().classList.toggle('item-picker-modal', wide);
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

/** The window a slot's picker was opened from (a hero, a set), which its header leads back to. */
interface Back {
  label: string;
  go: () => void;
  /** that window is the hero's, so the button names the hero and the title need not */
  hero?: boolean;
}

/** `donor`: the item of the slot whose effect the chosen one wears, '' for none (src/item-builder-donor.ts) */
interface SlotState { slot: string; selectedId: string; effectIds: string[]; donor: string; style: number; query: string; back: Back | null; busy: boolean }

/**
 * @param from  the card it grows out of
 * @param opts.query  typed into the search, for a card found by the catalog's search or in favourites
 * @param opts.select  the item chosen when it opens, for a piece opened from its set; the one on otherwise
 */
export function openItemSlotModal(slot: string, from: Element | null,
  { query = '', select = '', back = null }: { query?: string; select?: string; back?: Back | null } = {}): void {
  const data = slotData(slot);
  if (!data) return;
  const live = pickedIn(slot);
  const selectedId = select || live?.itemId || '';
  const same = live?.itemId === selectedId;
  const st: SlotState = { slot, selectedId, effectIds: same ? liveEffects(live) : [], donor: same ? liveDonor(live) : '', style: same ? liveStyle(live) : 0, query, back, busy: false };
  openWindow(from, true, (key) => drawSlot(key, st));
  loadCosmeticIcons(data.options.slice(0, 36).map((o) => o.name).filter(Boolean), () => {}).catch(() => {});
}

/** An effect of the game's own (Ethereal Flame and the like), src/item-builder-unusual.ts. */
const GAME_EFFECT = /^unusual-\d+$/;

function drawSlot(key: number, st: SlotState): void {
  const data = slotData(st.slot);
  if (!data) return;
  const live = pickedIn(st.slot);
  const hasItem = !!st.selectedId;
  const effects = (data.effects || []).filter((fx) => fx.id);
  const chosen = hasItem ? data.options.find((o) => o.id === st.selectedId) : null;
  const styles = chosen?.styles && chosen.styles.length > 1 ? chosen.styles : null;
  // the slot's items with an effect of their own, the chosen one aside (issue #383)
  const donors = data.options.filter((o) => o.fx && o.id !== st.selectedId);
  const donor = hasItem && st.donor ? data.options.find((o) => o.id === st.donor) : null;
  const names = [...effects.filter((e) => st.effectIds.includes(e.id)).map((e) => e.name), ...(donor ? [L`эффект: ${cosmeticName(donor.name)}`] : []),
    ...(styles && st.style ? [styles[st.style]] : [])];
  const again = () => drawSlot(key, st);
  showSlotPicker(key, {
    back: st.back?.hero ? heroName(st.back.label) : cosmeticName(st.back?.label || '') || null,
    title: (st.back?.hero && data.slotLabel) || heroName(data.label || catName(COSMETIC_PREFIX + st.slot)),
    optionsCount: data.options.length,
    query: st.query,
    slotIcon: data.icon || 'checkroom',
    // the hero's own item first: choosing it is how a pick comes off
    options: byName([{ id: '', name: L`Стандартный`, tags: [] }, ...data.options], st.query).map((o) => ({
      id: o.id, name: o.name, tags: tagLine(o.tags), picked: o.id === st.selectedId, on: o.id ? live?.itemId === o.id : !live,
      ...('note' in o && o.note ? { note: o.note } : {}),
    })),
    styles: styles ? styles.map((name, index) => ({ index, name, picked: index === st.style })) : null,
    effects: effects.length ? {
      none: hasItem && !st.effectIds.length,
      list: effects.filter((fx) => !GAME_EFFECT.test(fx.id)).map((fx) => ({ id: fx.id, name: fx.name, picture: effectPicture(fx.id), picked: hasItem && st.effectIds.includes(fx.id) })),
      game: effects.filter((fx) => GAME_EFFECT.test(fx.id)).map((fx) => ({ id: fx.id, name: fx.name, picked: hasItem && st.effectIds.includes(fx.id) })),
      enabled: hasItem,
      hint: hasItem
        ? L`Можно выбрать несколько. Иней и Снег держатся не на всех моделях.`
        : L`Эффект добавляется к предмету: сначала выбери его выше.`,
    } : null,
    donors: donors.length ? {
      none: hasItem && !st.donor,
      list: donors.map((o) => ({ id: o.id, name: o.name, picked: hasItem && st.donor === o.id })),
      enabled: hasItem,
    } : null,
    summary: { name: chosen ? chosen.name : L`Стандартный`, effects: chosen && names.length ? names.join(', ') : '' },
    action: stagedItemAction(data.effects, live, st),
  }, {
    back: () => st.back?.go(),
    close: closeOverlay,
    search: (q) => { st.query = q; again(); },
    choose: (id) => {
      if (st.busy) return;
      st.selectedId = id;
      if (!id) st.effectIds = []; // the stock item takes no effects
      if (!id || id === st.donor) st.donor = '';
      // another item starts in its first style, or the one it is on in
      st.style = live?.itemId === id ? liveStyle(live) : 0;
      again();
    },
    style: (index) => {
      if (st.busy || !st.selectedId) return;
      st.style = index;
      again();
    },
    effect: (id) => {
      if (st.busy || !st.selectedId) return;
      st.effectIds = !id ? [] : st.effectIds.includes(id) ? st.effectIds.filter((x) => x !== id) : [...st.effectIds, id];
      again();
    },
    donor: (id) => {
      if (st.busy || !st.selectedId) return;
      st.donor = id === st.donor ? '' : id;
      again();
    },
    apply: () => applySlot(key, st, chosen),
  });
}

async function applySlot(key: number, st: SlotState, chosen: CosmeticOption | null | undefined): Promise<void> {
  const data = slotData(st.slot);
  if (!data || !cat) return;
  const act = stagedItemAction(data.effects, pickedIn(st.slot), st);
  // taking a pick off puts the stock item back, which has no id of its own
  const look = act.remove ? { id: '', name: L`Стандартный` } : chosen;
  if (act.off || !look) return;
  st.busy = true;
  drawSlot(key, st);
  try {
    await cat.pickCosmetic(st.slot, look, !!act.remove, effectKey(data.effects, st.effectIds, st.style, st.donor));
  } finally {
    st.busy = false;
    if (isOpen(key)) drawSlot(key, st);
  }
}

// ---------- a hero: its sets as one tile, then a tile per item slot ----------

const heroSlots = (hero: string): CosmeticSlot[] => heroesOf(itemCosmeticSlots()).find(([h]) => h === hero)?.[1] || [];

export function openItemHeroModal(heroName: string, from: Element | null): void {
  const slots = heroSlots(heroName);
  openWindow(from, false, (key) => drawHero(key, heroName, slots));
  const sets = heroSets(heroName);
  loadCosmeticIcons([sets[0]?.name, ...slots.slice(0, 12).map((s) => pickedIn(s.slot)?.name || s.options[0]?.name)].filter(Boolean), () => {})
    .catch(() => {});
}

/** The 3D preview is open: it stays so from one hero to the next, as a person who looks once looks again. */
let previewOpen = false;

/** What the 3D preview shows for the hero: each slot's stock item and what is picked on it. */
function heroPreview(slots: CosmeticSlot[]) {
  const hero = slots.find((s) => s.heroIds?.length)?.heroIds?.[0];
  const dressed = slots.filter((s) => s.targetId && !s.persona);
  if (!hero || !dressed.length) return null;
  return {
    hero,
    slots: dressed.map((s) => ({ slot: s.slot, stock: s.targetId as string })),
    sig: dressed.map((s) => { const p = pickedIn(s.slot); return p ? `${p.itemId}:${p.effectId || ''}` : '-'; }).join('|'),
    open: previewOpen,
  };
}

/** The hero's npc name without its prefix (juggernaut), out of the slots' hero ids. */
const heroNpc = (slots: CosmeticSlot[]): string | null => slots.find((s) => s.heroIds?.length)?.heroIds?.[0]?.replace(/^npc_dota_hero_/, '') || null;

function drawHero(key: number, heroName: string, slots: CosmeticSlot[]): void {
  const sets = heroSets(heroName);
  const shown = sets.find((s) => setIsOn(s, pickedIn)) || sets[0];
  showHeroModal(key, {
    hero: heroName,
    hub: catName(HUB),
    slots: slots.map((s) => {
      const live = pickedIn(s.slot);
      return {
        slot: s.slot,
        label: s.slotLabel || s.label || '',
        icon: s.icon || 'checkroom',
        liveName: live?.name || null,
        meta: live ? live.name : `${s.options.length} ${plural(s.options.length, 'вариант', 'варианта', 'вариантов')}`,
      };
    }),
    sets: sets.length ? { name: shown.name, count: sets.length, on: sets.some((s) => setIsOn(s, pickedIn)) } : null,
    preview: heroPreview(slots),
    paint: heroNpc(slots),
  }, {
    close: closeOverlay,
    togglePreview: () => { previewOpen = !previewOpen; drawHero(key, heroName, slots); },
    openPaint: () => { const npc = heroNpc(slots); if (npc) void openPaint(npc, heroName, () => openItemHeroModal(heroName, null)); },
    openSets: () => openSets(heroName),
    openSlot: (slot) => openItemSlotModal(slot, null,
      { back: { label: heroName, hero: true, go: () => openItemHeroModal(heroName, null) } }),
  });
}

/** Let go of an open builder window: another window is taking the overlay, or it closed. */
function forgetItemSlotModal() {
  opened++;
  redrawOpen = null;
  panel().classList.remove('item-picker-modal');
}
sharesOverlay(forgetItemSlotModal);

/** Mark the open builder window again: what is on changed. */
export function redrawItemSlotModal(): void {
  redrawOpen?.();
}

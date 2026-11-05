/* The item builder's sets: a hero's list of them, and one set, every piece of it put on in one
 * write (src/item-builder.ts itemSets). The windows are catalog/builder/SetsModal.tsx; the rest
 * of the builder is views/item-builder.ts.
 *
 * Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
 * (https://github.com/TheFleece).
 * Copyright (C) 2026 h6rd
 * Copyright (C) 2026 TheFleece
 * SPDX-License-Identifier: GPL-3.0-or-later
 * The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
 * the credits of the program it goes into.
 */
import { pickedIn } from '../core/installed.ts';
import { showSetsModal, showSetModal } from '../catalog/modal/root.tsx';
import { liveStyle, matchingSets, setCardMeta, setCount, setIsOn } from '../catalog/builder/logic.ts';
import { SET_FILTERS, activeFilters, filterSets, readSetFilters, setFacets, writeSetFilters, type SetFilters } from '../catalog/builder/set-filters.ts';
import { plural } from '../ui/format.ts';
import { toast } from '../ui/toast.ts';
import { cosmeticName } from '../ui/cosmetic-name.ts';
import { loadCosmeticIcons } from '../ui/cosmetic-icons.ts';
import { closeOverlay } from './catalog/overlay.ts';
import { allowItemTable } from '../ui/game-files.ts';
import { afterPick, heroSets, isOpen, openItemSlotModal, openWindow } from './item-builder.ts';
import { openItemHeroModal } from './item-hero.ts';
import type { CosmeticSet } from '../catalog/types.ts';
import type { BuilderAction } from '../catalog/builder/model.ts';

/** A hero's sets on show, with what was typed into their search, kept for the way back from a set. */
interface SetsState { heroName: string; query: string }
interface SetState { set: CosmeticSet; back: SetsState; busy: boolean; style: number }

const storage = (): Storage | null => { try { return localStorage; } catch { return null; } };
/** The sets toolbar as it was left, for every hero (catalog/builder/set-filters.ts). */
let filters: SetFilters | null = null;
const setFilters = (): SetFilters => (filters ||= readSetFilters(storage()));

/** The style the set's styled pieces wear now, 0 when none is on. */
const styleOn = (set: CosmeticSet): number => {
  const p = set.pieces.find((x) => x.fits && pickedIn(x.slot)?.itemId === x.itemId && liveStyle(pickedIn(x.slot)));
  return p ? liveStyle(pickedIn(p.slot)) : 0;
};

/** A hero's sets; query: what was typed into their search, kept for the way back from a set. */
export function openSets(heroName: string, query = ''): void {
  const st: SetsState = { heroName, query };
  openWindow(null, true, (key) => drawSets(key, st));
  loadCosmeticIcons(heroSets(heroName).slice(0, 36).map((s) => s.name), () => {}).catch(() => {});
}

function drawSets(key: number, st: SetsState): void {
  const sets = heroSets(st.heroName);
  const f = setFilters();
  const facets = setFacets(sets);
  const again = () => drawSets(key, st);
  showSetsModal(key, {
    hero: st.heroName,
    count: sets.length,
    query: st.query,
    sets: filterSets(matchingSets(sets, st.query), f).map((s) => {
      const on = setIsOn(s, pickedIn);
      return { id: s.id, name: s.name, on, meta: setCardMeta(s, on), rarity: s.rarity || '', rarityName: s.rarityName || '', year: (s.date || '').slice(0, 4) };
    }),
    filters: f,
    facets: { ...facets, styled: sets.some((s) => (s.styles || 1) > 1) },
    active: activeFilters(f),
  }, {
    filter: (patch) => { filters = { ...f, ...patch }; writeSetFilters(storage(), filters); again(); },
    reset: () => { filters = { ...SET_FILTERS, sort: f.sort }; writeSetFilters(storage(), filters); again(); },
    back: () => openItemHeroModal(st.heroName, null),
    close: closeOverlay,
    search: (q) => { st.query = q; drawSets(key, st); },
    open: (id) => {
      const set = sets.find((s) => s.id === id);
      if (set) openSet(set, st);
    },
  });
}

/** One set. back: the list it was opened from, with its search. */
function openSet(set: CosmeticSet, back: SetsState): void {
  const st: SetState = { set, back, busy: false, style: styleOn(set) };
  openWindow(null, true, (key) => drawSet(key, st));
  loadCosmeticIcons(set.pieces.map((p) => p.name), () => {}).catch(() => {});
}

// A piece opens its slot's window with it chosen: a set brings no effects, and that is where they
// go on. The search there has the piece typed in, so its one card sits right above the effects.
function drawSet(key: number, st: SetState): void {
  const { set } = st;
  const count = setCount(set);
  showSetModal(key, {
    name: set.name,
    hero: set.heroLabel,
    count,
    pieces: set.pieces.map((p, index) => {
      const on = p.fits && pickedIn(p.slot)?.itemId === p.itemId;
      return { index, name: p.name, fits: p.fits, on, meta: !p.fits ? p.reason || '' : on ? `${p.slotLabel} · ${L`Надето`}` : p.slotLabel || '' };
    }),
    facts: { rarity: set.rarity || '', rarityName: set.rarityName || '', date: set.date || '', event: set.eventName || '', description: set.description || '' },
    styles: (set.styleNames?.length || 0) > 1 ? (set.styleNames as string[]).map((name, index) => ({ index, name, picked: index === st.style })) : null,
    action: setAction(st),
  }, {
    back: () => openSets(st.back.heroName, st.back.query),
    close: closeOverlay,
    style: (index) => { if (!st.busy) { st.style = index; drawSet(key, st); } },
    piece: (index) => {
      const p = set.pieces[index];
      openItemSlotModal(p.slot, null, { query: p.name, select: p.itemId, back: { label: set.name, go: () => openSet(set, st.back) } });
    },
    apply: () => applySet(key, st),
  });
}

const setAction = (st: SetState): BuilderAction => (st.busy ? { label: L`Надеваю…`, icon: 'hourglass_top', off: true }
  : !setIsOn(st.set, pickedIn) ? { label: L`Надеть весь набор`, icon: 'checkroom' }
    : styleOn(st.set) === st.style ? { label: L`Надето`, icon: 'check', off: true } : { label: L`Надеть в этом стиле`, icon: 'palette' });

async function applySet(key: number, st: SetState): Promise<void> {
  if (setAction(st).off) return;
  if (!await allowItemTable()) return;
  st.busy = true;
  drawSet(key, st);
  let r: { error?: string; applied?: number; pieces?: number };
  try {
    r = await window.api.cosmetics.pickSet(st.set.id, st.style);
  } catch (err) {
    r = { error: String((err as Error)?.message || err) };
  }
  st.busy = false;
  if (r.error) toast(r.error, 'error');
  else toast(r.applied === r.pieces ? L`Надето: ${cosmeticName(st.set.name)}` : L`Надето ${r.applied} из ${r.pieces} ${plural(r.pieces || 0, 'детали', 'деталей', 'деталей')}`);
  if (!r.error) await afterPick();
  if (isOpen(key)) drawSet(key, st);
}

/* The item builder's sets, a tab of the hero's window (views/item-hero.ts): a hero's list of them,
 * and one set, every piece of it put on in one write (src/item-builder.ts itemSets). Drawn by
 * catalog/builder/SetsPane.tsx; the rest of the builder is views/item-builder.ts.
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
import { liveStyle, matchingSets, rarityName, setCardMeta, setCount, setIsOn } from '../catalog/builder/logic.ts';
import { SET_FILTERS, activeFilters, filterSets, readSetFilters, setFacets, writeSetFilters, type SetFilters } from '../catalog/builder/set-filters.ts';
import { plural } from '../ui/format.ts';
import { toast } from '../ui/toast.ts';
import { cosmeticName } from '../ui/cosmetic-name.ts';
import { loadCosmeticIcons } from '../ui/cosmetic-icons.ts';
import { allowItemTable } from '../ui/game-files.ts';
import { afterPick, heroSets } from './item-builder.ts';
import type { CosmeticSet } from '../catalog/types.ts';
import type { BuilderAction, HeroPane } from '../catalog/builder/model.ts';

/** The sets tab as it was left: what was typed into its search, and the one set open, if any. */
export interface SetsState { query: string; set: SetState | null }
interface SetState { set: CosmeticSet; busy: boolean; style: number }

const storage = (): Storage | null => { try { return localStorage; } catch { return null; } };
/** The sets toolbar as it was left, for every hero (catalog/builder/set-filters.ts). */
let filters: SetFilters | null = null;
const setFilters = (): SetFilters => (filters ||= readSetFilters(storage()));

/** The style the set's styled pieces wear now, 0 when none is on. */
const styleOn = (set: CosmeticSet): number => {
  const p = set.pieces.find((x) => x.fits && pickedIn(x.slot)?.itemId === x.itemId && liveStyle(pickedIn(x.slot)));
  return p ? liveStyle(pickedIn(p.slot)) : 0;
};

/** The pictures of a hero's first sets, asked for as the tab opens. */
export const loadSetIcons = (heroName: string): void => {
  loadCosmeticIcons(heroSets(heroName).slice(0, 36).map((s) => s.name), () => {}).catch(() => {});
};

/**
 * The sets tab: the list, or the set opened from it.
 * @param openPiece  a piece's own slot tab, with the piece chosen: a set brings no effects, and that is where they go on
 */
export function setsPane(heroName: string, st: SetsState, redraw: () => void, openPiece: (slot: string, itemId: string) => void): HeroPane {
  if (st.set) return setPane(st, st.set, redraw, openPiece);
  const sets = heroSets(heroName);
  const f = setFilters();
  const facets = setFacets(sets);
  return {
    kind: 'sets',
    m: {
      count: sets.length,
      query: st.query,
      sets: filterSets(matchingSets(sets, st.query), f).map((s) => {
        const on = setIsOn(s, pickedIn);
        return { id: s.id, name: s.name, on, meta: setCardMeta(s, on), rarity: s.rarity || '', rarityName: s.rarityName || rarityName(s.rarity), year: (s.date || '').slice(0, 4) };
      }),
      filters: f,
      facets: { ...facets, styled: sets.some((s) => (s.styles || 1) > 1) },
      active: activeFilters(f),
    },
    actions: {
      filter: (patch) => { filters = { ...f, ...patch }; writeSetFilters(storage(), filters); redraw(); },
      reset: () => { filters = { ...SET_FILTERS, sort: f.sort }; writeSetFilters(storage(), filters); redraw(); },
      search: (q) => { st.query = q; redraw(); },
      open: (id) => {
        const set = sets.find((s) => s.id === id);
        if (!set) return;
        st.set = { set, busy: false, style: styleOn(set) };
        loadCosmeticIcons(set.pieces.map((p) => p.name), () => {}).catch(() => {});
        redraw();
      },
    },
  };
}

function setPane(list: SetsState, st: SetState, redraw: () => void, openPiece: (slot: string, itemId: string) => void): HeroPane {
  const { set } = st;
  return {
    kind: 'set',
    m: {
      name: set.name,
      count: setCount(set),
      pieces: set.pieces.map((p, index) => {
        const on = p.fits && pickedIn(p.slot)?.itemId === p.itemId;
        return { index, name: p.name, fits: p.fits, on, meta: !p.fits ? p.reason || '' : on ? `${p.slotLabel} · ${L`Надето`}` : p.slotLabel || '' };
      }),
      facts: { rarity: set.rarity || '', rarityName: set.rarityName || rarityName(set.rarity), date: set.date || '', event: set.eventName || '', description: set.description || '' },
      styles: (set.styleNames?.length || 0) > 1 ? (set.styleNames as string[]).map((name, index) => ({ index, name, picked: index === st.style })) : null,
      action: setAction(st),
    },
    actions: {
      back: () => { list.set = null; redraw(); },
      style: (index) => { if (!st.busy) { st.style = index; redraw(); } },
      piece: (index) => { const p = set.pieces[index]; if (p.fits) openPiece(p.slot, p.itemId); },
      apply: () => void applySet(st, redraw),
    },
  };
}

const setAction = (st: SetState): BuilderAction => (st.busy ? { label: L`Надеваю…`, icon: 'hourglass_top', off: true }
  : !setIsOn(st.set, pickedIn) ? { label: L`Надеть весь набор`, icon: 'checkroom' }
    : styleOn(st.set) === st.style ? { label: L`Надето`, icon: 'check', off: true } : { label: L`Надеть в этом стиле`, icon: 'palette' });

async function applySet(st: SetState, redraw: () => void): Promise<void> {
  if (setAction(st).off) return;
  if (!await allowItemTable()) return;
  st.busy = true;
  redraw();
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
  redraw();
}

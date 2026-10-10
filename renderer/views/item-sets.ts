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
import { matchingSets, setCardMeta, setCount, setIsOn } from '../catalog/builder/logic.ts';
import { plural } from '../ui/format.ts';
import { toast } from '../ui/toast.ts';
import { cosmeticName } from '../ui/cosmetic-name.ts';
import { state } from '../core/store.ts';
import { loadCosmeticIcons } from '../ui/cosmetic-icons.ts';
import { closeOverlay } from './catalog/overlay.ts';
import { afterPick, heroSets, isOpen, openItemHeroModal, openItemSlotModal, openWindow } from './item-builder.ts';
import type { CosmeticSet } from '../catalog/types.ts';
import type { BuilderAction } from '../catalog/builder/model.ts';

/** A hero's sets on show, with what was typed into their search, kept for the way back from a set. */
interface SetsState { heroName: string; query: string }
interface SetState { set: CosmeticSet; back: SetsState; busy: boolean }

/** A hero's sets; query: what was typed into their search, kept for the way back from a set. */
export function openSets(heroName: string, query = ''): void {
  const st: SetsState = { heroName, query };
  openWindow(null, true, (key) => drawSets(key, st));
  loadCosmeticIcons(heroSets(heroName).slice(0, 36).map((s) => s.name), () => {}).catch(() => {});
}

function drawSets(key: number, st: SetsState): void {
  const sets = heroSets(st.heroName);
  showSetsModal(key, {
    hero: st.heroName,
    count: sets.length,
    query: st.query,
    sets: matchingSets(sets, st.query).map((s) => {
      const on = setIsOn(s, pickedIn);
      return { id: s.id, name: s.name, on, meta: setCardMeta(s, on) };
    }),
  }, {
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
  const st: SetState = { set, back, busy: false };
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
    action: setAction(st),
  }, {
    back: () => openSets(st.back.heroName, st.back.query),
    close: closeOverlay,
    piece: (index) => {
      const p = set.pieces[index];
      openItemSlotModal(p.slot, null, { query: p.name, select: p.itemId, back: { label: set.name, go: () => openSet(set, st.back) } });
    },
    apply: () => applySet(key, st),
  });
}

const setAction = (st: SetState): BuilderAction => (st.busy ? { label: L`Надеваю…`, icon: 'hourglass_top', off: true }
  : !state.settings?.schemaPatch ? { label: L`Выключи безопасный режим, чтобы надеть`, icon: 'shield', off: true }
  : setIsOn(st.set, pickedIn) ? { label: L`Надето`, icon: 'check', off: true } : { label: L`Надеть весь набор`, icon: 'checkroom' });

async function applySet(key: number, st: SetState): Promise<void> {
  if (setAction(st).off) return;
  st.busy = true;
  drawSet(key, st);
  let r: { error?: string; applied?: number; pieces?: number };
  try {
    r = await window.api.cosmetics.pickSet(st.set.id);
  } catch (err) {
    r = { error: String((err as Error)?.message || err) };
  }
  st.busy = false;
  if (r.error) toast(r.error, 'error');
  else toast(r.applied === r.pieces ? L`Надето: ${cosmeticName(st.set.name)}` : L`Надето ${r.applied} из ${r.pieces} ${plural(r.pieces || 0, 'детали', 'деталей', 'деталей')}`);
  if (!r.error) await afterPick();
  if (isOpen(key)) drawSet(key, st);
}

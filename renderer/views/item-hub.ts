/* The item builder's hub: every hero the game's own table lets the builder dress, with what is
 * on each. A hero opens its window (views/item-builder.ts).
 *
 * Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
 * (https://github.com/TheFleece).
 * Copyright (C) 2026 h6rd
 * Copyright (C) 2026 TheFleece
 * SPDX-License-Identifier: GPL-3.0-or-later
 * The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
 * the credits of the program it goes into.
 */
import { state } from '../core/store.ts';
import { COSMETIC_PREFIX } from '../core/constants.ts';
import { catName, catIcon } from '../core/categories.ts';
import { pickedIn, refreshCosmeticSlots } from '../core/installed.ts';
import { showScreen } from '../catalog/screen/root.tsx';
import { heroCardMeta, heroesOf } from '../catalog/builder/logic.ts';
import type { CosmeticSlot } from '../catalog/types.ts';
import type { ScreenActions, ScreenModel } from '../catalog/screen/model.ts';
import { plural } from '../ui/format.ts';
import { heroMatchesSearch } from '../ui/hero-name.ts';
import { officialOnly } from '../catalog/source.ts';
import { paint } from '../ui/transitions.ts';
import { view } from './catalog/state.ts';
import { catalogActions, heroSets, itemCosmeticSlots } from './item-builder.ts';

const HUB = COSMETIC_PREFIX + 'items';

// the search and "Надетые" narrow the hub in place, without reading the catalog again
const hubActions = (): ScreenActions => ({
  ...catalogActions(),
  cosmeticFilter: ({ search, installedOnly }) => {
    if (search !== undefined) view.cosSearch = search;
    if (installedOnly !== undefined) view.filters.installedOnly = installedOnly;
    drawHub();
  },
});

function hubModel(): ScreenModel {
  const f = view.filters;
  const q = view.cosSearch.trim().toLowerCase();
  const shown = heroesOf(itemCosmeticSlots()).filter(([hero, slots]) =>
    heroMatchesSearch(hero, q) && (!f.installedOnly || slots.some((s) => pickedIn(s.slot))));
  return {
    kind: 'builder' as const,
    title: officialOnly() ? L`Официальные предметы героев` : catName(HUB),
    search: view.cosSearch,
    installedOnly: f.installedOnly,
    count: (view.cosSearch || f.installedOnly) ? `${shown.length} ${plural(shown.length, 'герой', 'героя', 'героев')}` : '',
    heroes: shown.map(([hero, slots]) => ({
      hero,
      icon: heroPortraits.get(hero) || null,
      installed: slots.some((s) => pickedIn(s.slot)),
      meta: heroCardMeta(slots, heroSets(hero), pickedIn),
    })),
  };
}

const drawHub = () => showScreen(hubModel(), hubActions());

const hubNote = (note: string) => paint(() => showScreen(
  { kind: 'list', key: 'cos:items:note', title: catName(HUB), toolbar: null, note, mods: null, cosmetics: null }, hubActions()));

export async function renderItemCosmeticHub(): Promise<void> {
  // said only while there is something to wait for: the game's schema, or the portraits the first time
  const waiting = !state.cosmeticSlots || heroesOf(itemCosmeticSlots()).some(([hero]) => !heroPortraits.has(hero));
  if (waiting) await hubNote(L`Читаем схему игры…`);
  if (!state.cosmeticSlots) await refreshCosmeticSlots();
  const list = heroesOf(itemCosmeticSlots());
  await loadHeroPortraits(list);
  if (state.activeCategory !== HUB) return; // moved on while reading
  if (!list.length) { await hubNote(L`Схема игры не прочиталась — проверь путь к Dota 2 в настройках.`); return; }
  view.filters.favOnly = false;
  await paint(drawHub);
}

// A hero's portrait, read out of the installed game (src/game-icons.ts heroPortraits): the game
// keeps them as plain PNG, so this needs no toolchain and no network. Keyed by the label the hub
// shows. They used to ship inside the app, 132 of Valve's pictures in a GPL repository.
const heroPortraits = new Map<string, string | null>();

async function loadHeroPortraits(heroes: [string, CosmeticSlot[]][]): Promise<void> {
  const want = new Map<string, string[]>(); // hero id -> the labels that show it
  for (const [label, slots] of heroes) {
    const id = slots[0]?.heroIds?.[0];
    if (id && !heroPortraits.has(label)) want.set(id, [...(want.get(id) || []), label]);
  }
  if (!want.size) return;
  let got: Record<string, string> = {};
  try { got = await window.api.cosmetics.heroPortraits([...want.keys()]); } catch { /* no game: glyphs */ }
  for (const [id, labels] of want) for (const label of labels) heroPortraits.set(label, got[id] || null);
}

/** The builder's one entry in the catalog rail (catalog/rail/Rail.tsx), or null with no item slots. */
export function itemRailEntry() {
  const slots = itemCosmeticSlots();
  if (!slots.length) return null;
  return { id: HUB, icon: catIcon(HUB), name: catName(HUB), dot: slots.some((s) => pickedIn(s.slot)) };
}

/** Draw the hub again after a pick, when it is the screen on show; it stays where it was scrolled. */
export async function refreshItemHub(): Promise<void> {
  if (state.view !== 'catalog' || state.activeCategory !== HUB || !state.cosmeticSlots) return;
  drawHub();
}

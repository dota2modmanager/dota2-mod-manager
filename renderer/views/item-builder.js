/* The item builder in the catalog: a hero's items, each built from one of its wearables with an
 * effect on top. The hub lists heroes, a hero opens its item slots and its sets, and a slot opens
 * the picker of wearables and effects. What a pick does to the game is src/item-builder.js; this
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
 * It lives beside the catalog rather than inside it, and reaches the catalog only through what
 * bindItemBuilder hands over: the window, the slot data, the pick itself, the filters and search.
 * It keeps what is chosen and works out what each window shows; catalog/builder/ draws it, and
 * catalog/builder/logic.ts holds the rules.
 */
import { $ } from '../core/dom.js';
import { state } from '../core/store.js';
import { COSMETIC_PREFIX } from '../core/constants.js';
import { catName, catIcon } from '../core/categories.js';
import { pickedIn, refreshCosmeticSlots } from '../core/installed.js';
import { showScreen } from '../catalog/screen/root.tsx';
import { showSlotPicker, showHeroModal } from '../catalog/modal/root.tsx';
import { byName, effectKey, effectPicture, heroCardMeta, heroesOf, liveEffects, setIsOn, stagedItemAction,
  tagLine } from '../catalog/builder/logic.ts';
import { plural } from '../ui/format.js';
import { paint } from '../ui/transitions.js';
import { loadCosmeticIcons } from '../ui/cosmetic-icons.js';
import { openSets } from './item-sets.js';

/** What the catalog hands over; set once by bindItemBuilder before anything here runs. */
let cat = null;

/**
 * @param {{ slotData: Function, cosmeticSlotList: Function, pickCosmetic: Function, afterPick: Function,
 *   openModal: Function, closeModal: Function, resetModalState: Function, filters: () => object,
 *   search: () => string, setSearch: (v: string) => void }} ctx
 */
export function bindItemBuilder(ctx) {
  cat = ctx;
}

const HUB = COSMETIC_PREFIX + 'items';

function itemCosmeticSlots() {
  return cat.cosmeticSlotList().filter((s) => s.kind === 'item-effect' || String(s.slot || '').startsWith('item:'));
}

export function isItemCosmeticSlot(slot) {
  return cat.slotData(slot)?.kind === 'item-effect' || String(slot || '') === 'items' || String(slot || '').startsWith('item:');
}

export function cosmeticFavValue(slot, o) {
  return isItemCosmeticSlot(slot) ? o.id : o.name;
}

export const heroSets = (heroName) => (state.cosmeticSets || []).filter((s) => s.heroLabel === heroName);

/* One builder window on show at a time. Each open counts up: the count is the window's key, so
 * opening draws it fresh (its cards play their entrance) and a change inside it updates in place. */
let opened = 0;
let redrawOpen = null;

/** Put a builder window on the overlay. wide: a picker, the wide one; the hero's own window is not. */
export function openWindow(from, wide, draw) {
  const key = ++opened;
  redrawOpen = () => { if (isOpen(key)) draw(key); };
  cat.resetModalState();
  cat.openModal(() => {
    $('#modalContent').classList.toggle('item-picker-modal', wide);
    draw(key);
  }, from);
}

/** Still the window on show: a pick that took a while may come back to a closed or different one. */
export const isOpen = (key) => opened === key;

/** What the set windows (views/item-sets.js) reach the catalog through. */
export const builderCtx = () => cat;

// ---------- a slot: its wearables, the effects on top, and the button that puts them on ----------

/**
 * @param {string} slot
 * @param {Element|null} from  the card it grows out of
 * @param {{ query?: string, select?: string, back?: { label: string, go: () => void, hero?: boolean } }} [opts]
 *   query: typed into the search, for a card found by the catalog's search or in favourites;
 *   select: the item chosen when it opens, for a piece opened from its set; the one on otherwise;
 *   back: the window it was opened from (a hero, a set), which the header then leads back to;
 *   hero: that window is the hero's, so the button names the hero and the title need not
 */
export function openItemSlotModal(slot, from, { query = '', select = '', back = null } = {}) {
  const data = cat.slotData(slot);
  if (!data) return;
  const live = pickedIn(slot);
  const selectedId = select || live?.itemId || '';
  const st = { slot, selectedId, effectIds: live?.itemId === selectedId ? liveEffects(live) : [], query, back, busy: false };
  openWindow(from, true, (key) => drawSlot(key, st));
  loadCosmeticIcons(data.options.slice(0, 36).map((o) => o.name).filter(Boolean), () => {}).catch(() => {});
}

function drawSlot(key, st) {
  const data = cat.slotData(st.slot);
  if (!data) return;
  const live = pickedIn(st.slot);
  const hasItem = !!st.selectedId;
  const effects = (data.effects || []).filter((fx) => fx.id);
  const chosen = hasItem ? data.options.find((o) => o.id === st.selectedId) : null;
  const names = effects.filter((e) => st.effectIds.includes(e.id)).map((e) => e.name);
  const again = () => drawSlot(key, st);
  showSlotPicker(key, {
    back: st.back?.label || null,
    title: (st.back?.hero && data.slotLabel) || data.label || catName(COSMETIC_PREFIX + st.slot),
    optionsCount: data.options.length,
    query: st.query,
    slotIcon: data.icon || 'checkroom',
    // the hero's own item first: choosing it is how a pick comes off
    options: byName([{ id: '', name: L`Стандартный`, tags: [] }, ...data.options], st.query).map((o) => ({
      id: o.id, name: o.name, tags: tagLine(o.tags), picked: o.id === st.selectedId, on: o.id ? live?.itemId === o.id : !live,
    })),
    effects: effects.length ? {
      none: hasItem && !st.effectIds.length,
      list: effects.map((fx) => ({ id: fx.id, name: fx.name, picture: effectPicture(fx.id), picked: hasItem && st.effectIds.includes(fx.id) })),
      enabled: hasItem,
      hint: hasItem
        ? L`Можно выбрать несколько. Иней и Снег держатся не на всех моделях.`
        : L`Эффект добавляется к предмету: сначала выбери его выше.`,
    } : null,
    summary: { name: chosen ? chosen.name : L`Стандартный`, effects: chosen && names.length ? names.join(', ') : '' },
    action: stagedItemAction(data.effects, live, st),
  }, {
    back: () => st.back.go(),
    close: () => cat.closeModal(),
    search: (q) => { st.query = q; again(); },
    choose: (id) => {
      if (st.busy) return;
      st.selectedId = id;
      if (!id) st.effectIds = []; // the stock item takes no effects
      again();
    },
    effect: (id) => {
      if (st.busy || !st.selectedId) return;
      st.effectIds = !id ? [] : st.effectIds.includes(id) ? st.effectIds.filter((x) => x !== id) : [...st.effectIds, id];
      again();
    },
    apply: () => applySlot(key, st, chosen),
  });
}

async function applySlot(key, st, chosen) {
  const data = cat.slotData(st.slot);
  const act = stagedItemAction(data.effects, pickedIn(st.slot), st);
  if (act.off || (!act.remove && !chosen)) return;
  st.busy = true;
  drawSlot(key, st);
  try {
    await cat.pickCosmetic(st.slot, act.remove ? { id: '', name: L`Стандартный` } : chosen, !!act.remove, effectKey(data.effects, st.effectIds));
  } finally {
    st.busy = false;
    if (isOpen(key)) drawSlot(key, st);
  }
}

// ---------- a hero: its sets as one tile, then a tile per item slot ----------

export function openItemHeroModal(heroName, from) {
  const slots = heroSlots(heroName);
  openWindow(from, false, (key) => drawHero(key, heroName, slots));
  const sets = heroSets(heroName);
  loadCosmeticIcons([sets[0]?.name, ...slots.slice(0, 12).map((s) => pickedIn(s.slot)?.name || s.options[0]?.name)].filter(Boolean), () => {})
    .catch(() => {});
}

function drawHero(key, heroName, slots) {
  const sets = heroSets(heroName);
  const shown = sets.find((s) => setIsOn(s, pickedIn)) || sets[0];
  showHeroModal(key, {
    hero: heroName,
    hub: catName(HUB),
    slots: slots.map((s) => {
      const live = pickedIn(s.slot);
      return {
        slot: s.slot,
        label: s.slotLabel || s.label,
        icon: s.icon || 'checkroom',
        liveName: live?.name || null,
        meta: live ? live.name : `${s.options.length} ${plural(s.options.length, 'вариант', 'варианта', 'вариантов')}`,
      };
    }),
    sets: sets.length ? { name: shown.name, count: sets.length, on: sets.some((s) => setIsOn(s, pickedIn)) } : null,
  }, {
    close: () => cat.closeModal(),
    openSets: () => openSets(heroName),
    openSlot: (slot) => openItemSlotModal(slot, null,
      { back: { label: heroName, hero: true, go: () => openItemHeroModal(heroName, null) } }),
  });
}

// ---------- the hub: every hero the game's own table lets the builder dress ----------

const heroSlots = (hero) => heroesOf(itemCosmeticSlots()).find(([h]) => h === hero)?.[1] || [];

const hubActions = {
  cosmeticFilter: ({ search, installedOnly }) => {
    if (search !== undefined) cat.setSearch(search);
    if (installedOnly !== undefined) cat.filters().installedOnly = installedOnly;
    drawHub();
  },
  openHero: (hero, card) => openItemHeroModal(hero, card),
};

function hubModel() {
  const f = cat.filters();
  const q = cat.search().trim().toLowerCase();
  const shown = heroesOf(itemCosmeticSlots()).filter(([hero, slots]) =>
    (!q || hero.toLowerCase().includes(q)) && (!f.installedOnly || slots.some((s) => pickedIn(s.slot))));
  return {
    kind: 'builder',
    title: catName(HUB),
    search: cat.search(),
    installedOnly: f.installedOnly,
    count: (cat.search() || f.installedOnly) ? `${shown.length} ${plural(shown.length, 'герой', 'героя', 'героев')}` : '',
    heroes: shown.map(([hero, slots]) => ({
      hero,
      icon: heroPortraits.get(hero) || null,
      installed: slots.some((s) => pickedIn(s.slot)),
      meta: heroCardMeta(slots, heroSets(hero), pickedIn),
    })),
  };
}

const drawHub = () => showScreen(hubModel(), hubActions);

const hubNote = (note) => paint(() => showScreen(
  { kind: 'list', key: 'cos:items:note', title: catName(HUB), toolbar: null, note, mods: null, cosmetics: null }, hubActions));

export async function renderItemCosmeticHub() {
  // said only while there is something to wait for: the game's schema, or the portraits the first time
  const waiting = !state.cosmeticSlots || heroesOf(itemCosmeticSlots()).some(([hero]) => !heroPortraits.has(hero));
  if (waiting) await hubNote(L`Читаем схему игры…`);
  if (!state.cosmeticSlots) await refreshCosmeticSlots();
  const list = heroesOf(itemCosmeticSlots());
  await loadHeroPortraits(list);
  if (state.activeCategory !== HUB) return; // moved on while reading
  if (!list.length) return hubNote(L`Схема игры не прочиталась — проверь путь к Dota 2 в настройках.`);
  cat.filters().favOnly = false;
  await paint(drawHub);
}

// A hero's portrait, read out of the installed game (src/game-icons.js heroPortraits): the game
// keeps them as plain PNG, so this needs no toolchain and no network. Keyed by the label the hub
// shows. They used to ship inside the app, 132 of Valve's pictures in a GPL repository.
const heroPortraits = new Map();

async function loadHeroPortraits(heroes) {
  const want = new Map(); // hero id -> the labels that show it
  for (const [label, slots] of heroes) {
    const id = slots[0]?.heroIds?.[0];
    if (id && !heroPortraits.has(label)) want.set(id, [...(want.get(id) || []), label]);
  }
  if (!want.size) return;
  let got = {};
  try { got = await window.api.cosmetics.heroPortraits([...want.keys()]); } catch { /* no game: glyphs */ }
  for (const [id, labels] of want) for (const label of labels) heroPortraits.set(label, got[id] || null);
}

/** Let go of an open builder window: another window is taking the overlay, or it closed. */
export function forgetItemSlotModal() {
  opened++;
  redrawOpen = null;
  $('#modalContent').classList.remove('item-picker-modal');
}

/** The builder's one entry in the catalog rail (catalog/rail/Rail.tsx), or null with no item slots. */
export function itemRailEntry() {
  const slots = itemCosmeticSlots();
  if (!slots.length) return null;
  return { id: HUB, icon: catIcon(HUB), name: catName(HUB), dot: slots.some((s) => pickedIn(s.slot)) };
}

/** Draw the hub again after a pick, when it is the screen on show; it stays where it was scrolled. */
export async function refreshItemHub() {
  if (state.view !== 'catalog' || state.activeCategory !== HUB || !state.cosmeticSlots) return;
  drawHub();
}

/** Mark the open builder window again: what is on changed. */
export function redrawItemSlotModal() {
  redrawOpen?.();
}

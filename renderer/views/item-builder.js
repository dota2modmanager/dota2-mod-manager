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
 * It lives beside the catalog rather than inside it, and reaches the catalog only through what
 * bindItemBuilder hands over: the window, the slot data, the pick itself, the filters and search.
 */
import { $ } from '../core/dom.js';
import { state } from '../core/store.js';
import { COSMETIC_PREFIX } from '../core/constants.js';
import { catName, catIcon } from '../core/categories.js';
import { pickedIn, refreshCosmeticSlots } from '../core/installed.js';
import { pane } from '../core/router.js';
import { esc, plural } from '../ui/format.js';
import { paint } from '../ui/transitions.js';
import { toast } from '../ui/toast.js';
import { cosmeticIcon, loadCosmeticIcons, paintCosmeticIcons, watchCosmeticIcons } from '../ui/cosmetic-icons.js';

const viewRoot = pane('catalog');

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

function itemCosmeticSlots() {
  return cat.cosmeticSlotList().filter((s) => s.kind === 'item-effect' || String(s.slot || '').startsWith('item:'));
}

function hasItemCosmeticPick() {
  return itemCosmeticSlots().some((s) => pickedIn(s.slot));
}

export function isItemCosmeticSlot(slot) {
  return cat.slotData(slot)?.kind === 'item-effect' || String(slot || '') === 'items' || String(slot || '').startsWith('item:');
}

export function cosmeticFavValue(slot, o) {
  return isItemCosmeticSlot(slot) ? o.id : o.name;
}

let itemSlotModalState = null;

/** The set window on show, or the list of a hero's sets: { set, back, busy } / { list, back, query }. */
let itemSetState = null;

let itemSlotPickerIo = null;

let itemHubIo = null;

function cosmeticThumbSpanHtml(name, fallbackIcon, cls = 'card-thumb') {
  const icon = name ? cosmeticIcon(name) : null;
  return `<span class="${cls}"${name ? ` data-name="${esc(name)}"` : ''}>${icon
    ? `<img src="${esc(icon)}" alt="" loading="lazy">`
    : `<div class="noimg"><span class="ms">${esc(fallbackIcon || 'checkroom')}</span></div>`}</span>`;
}

/** The effects of a pick in the order the slot offers them, as one string: 'fire,snow'. */
function effectKey(data, ids) {
  const want = new Set(ids || []);
  return (data.effects || []).map((fx) => fx.id).filter((id) => id && want.has(id)).join(',');
}

/** A record's effects as a list (a record keeps them comma separated, src/item-builder.ts effectKey). */
function liveEffects(live) {
  return live?.effectId ? String(live.effectId).split(',').filter(Boolean) : [];
}

// The card the border marks is the one chosen here; "Надето" is said only of what the game shows,
// the one live pick or the stock item when there is none.
function itemSlotOptionCardHtml(slot, o, i) {
  const isNone = o.id === '';
  const tags = [...new Set((o.tags || []).map((t) => String(t).toLowerCase()))].join(', ');
  return `<button class="card item-pick-card" data-item-option="${esc(o.id)}" data-tags="${esc(tags)}" aria-pressed="false" style="--i:${Math.min(i, 24)}">
    <div class="card-media">
      ${isNone ? '<div class="noimg"><span class="ms">block</span></div>' : cosmeticThumbSpanHtml(o.name, cat.slotData(slot)?.icon || 'checkroom')}
    </div>
    <div class="card-body">
      <div class="card-name">${esc(o.name)}</div>
      <div class="card-meta"><span></span></div>
    </div>
  </button>`;
}

function itemSlotTileHtml(s) {
  const live = pickedIn(s.slot);
  const previewName = live?.name || '';
  return `<button class="card item-slot-card ${live ? 'installed' : ''}" data-item-slot="${esc(s.slot)}" style="--i:0">
    <div class="card-media">
      ${previewName ? cosmeticThumbSpanHtml(previewName, s.icon || 'checkroom', 'item-slot-thumb') : `<span class="item-slot-thumb"><div class="noimg"><span class="ms">${esc(s.icon || 'checkroom')}</span></div></span>`}
    </div>
    <div class="card-body">
      <div class="card-name">${esc(s.slotLabel || s.label)}</div>
      <div class="card-meta"><span>${live ? esc(live.name) : `${s.options.length} ${plural(s.options.length, 'вариант', 'варианта', 'вариантов')}`}</span></div>
    </div>
  </button>`;
}

/** The header of every builder window: the way back, the title, what it is, the close button. */
function builderHeadHtml(back, title, sub) {
  return `<div class="modal-title-row item-picker-head">
        <div>
          ${back ? `<button class="btn btn-sm btn-ghost item-back" id="itemBackBtn"><span class="ms">arrow_back</span>${esc(back)}</button>` : ''}
          <div class="modal-title">${esc(title)}</div>
          <div class="modal-sub">${sub}</div>
        </div>
        <button class="modal-close" id="modalCloseBtn" aria-label="${L`Закрыть`}"><span class="ms">close</span></button>
      </div>`;
}

/** What goes in the bar along the window's bottom: what it will put on, and the one button that does it. */
function builderFootHtml(summary, act) {
  return `<div class="item-picker-sum">${summary}</div>
        <button class="btn btn-primary" id="itemApplyBtn" ${act.off ? 'disabled' : ''}><span class="ms">${act.icon}</span>${esc(act.label)}</button>`;
}

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
  const effectIds = live?.itemId === selectedId ? liveEffects(live) : [];
  itemSlotModalState = { slot, selectedId, effectIds, query, back, busy: false };
  itemSetState = null;
  cat.resetModalState();
  cat.openModal(drawItemSlotModal, from);
  const firstVisible = data.options.slice(0, 36).map((o) => o.name).filter(Boolean);
  loadCosmeticIcons(firstVisible, () => {
    if (itemSlotModalState?.slot === slot) paintCosmeticIcons($('#modalContent'));
  });
}

/**
 * What the slot window's button does with what is chosen in it. Nothing reaches the game until it
 * is pressed: a pick used to be written on every click, and choosing three effects meant three
 * writes and three toasts.
 */
function stagedItemAction(data, live, st) {
  if (st.busy) return { label: L`Надеваю…`, icon: 'hourglass_top', off: true };
  if (!st.selectedId) {
    return live ? { label: L`Вернуть стандартный`, icon: 'undo', remove: true } : { label: L`Надето`, icon: 'check', off: true };
  }
  if (live?.itemId !== st.selectedId) return { label: L`Надеть`, icon: 'checkroom' };
  return effectKey(data, st.effectIds) === effectKey(data, liveEffects(live))
    ? { label: L`Надето`, icon: 'check', off: true }
    : { label: L`Сохранить эффекты`, icon: 'auto_awesome' };
}

function drawItemSlotModal() {
  const st = itemSlotModalState;
  const data = cat.slotData(st.slot);
  if (!data) return;
  const effectOptions = (data.effects || []).filter((fx) => fx.id);
  const back = st.back;

  $('#modalContent').classList.add('item-picker-modal');
  $('#modalContent').innerHTML = `
    <div class="modal-body item-picker-body">
      ${builderHeadHtml(back?.label, (back?.hero && data.slotLabel) || data.label || catName(COSMETIC_PREFIX + st.slot),
        `<span>${L`вид для стандартного предмета`}</span><span>· ${data.options.length} ${plural(data.options.length, 'вариант', 'варианта', 'вариантов')}</span>`)}
      <div class="tb-search item-picker-search"><span class="ms">search</span><input type="text" id="itemSlotSearch" placeholder="${L`Поиск…`}" value="${esc(st.query || '')}" autocomplete="off"></div>
      <div class="item-pick-grid" id="itemPickGrid"></div>
      ${effectOptions.length ? `
        <div class="section-h item-fx-head"><span class="ms">auto_awesome</span>${L`Эффекты`}</div>
        <div class="text-meta item-fx-hint" id="itemFxHint"></div>
        <div class="item-pick-grid" id="effectGrid">
          <button class="card item-pick-card" data-effect-none="true" style="--i:0">
            <div class="card-media"><div class="noimg"><span class="ms">block</span></div></div>
            <div class="card-body"><div class="card-name">${L`Без эффектов`}</div></div>
          </button>
          ${effectOptions.map((fx, idx) => {
            const picture = getEffectIconPath(fx.id);
            return `<button class="card item-pick-card" data-effect-id="${esc(fx.id)}" style="--i:${idx + 1}">
              <div class="card-media">
                ${picture ? `<span class="card-thumb"><img src="${esc(picture)}" alt="" loading="lazy"></span>` : '<div class="noimg"><span class="ms">auto_awesome</span></div>'}
              </div>
              <div class="card-body"><div class="card-name">${esc(fx.name)}</div></div>
            </button>`;
          }).join('')}
        </div>` : ''}
      <div class="modal-note">${L`Вид подставляется в схему предметов игры — стандартный предмет просто рисуется как выбранный. Файлы модов это не трогает, и видно только тебе.`}</div>
      <div class="item-picker-foot" id="itemPickFoot"></div>
    </div>`;

  $('#itemBackBtn')?.addEventListener('click', () => back.go());
  $('#modalCloseBtn').addEventListener('click', () => cat.closeModal());
  $('#itemSlotSearch').addEventListener('input', (e) => {
    st.query = e.target.value;
    paintItemOptions();
    syncItemSlotModal();
  });
  // one listener per grid: the options grid is drawn again as the search changes
  $('#itemPickGrid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-item-option]');
    if (!card || st.busy) return;
    st.selectedId = card.dataset.itemOption;
    if (!st.selectedId) st.effectIds = []; // the stock item takes no effects
    syncItemSlotModal();
  });
  $('#effectGrid')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-effect-id], [data-effect-none]');
    if (!card || st.busy || !st.selectedId) return;
    const id = card.dataset.effectId;
    st.effectIds = !id ? [] : st.effectIds.includes(id) ? st.effectIds.filter((x) => x !== id) : [...st.effectIds, id];
    syncItemSlotModal();
  });
  paintItemOptions();
  syncItemSlotModal();
}

// What a builder window shows when its search leaves nothing. The catalog's "clear the filters"
// pointed at controls these windows do not have: the search is the only thing narrowing them.
function emptySearchHtml() {
  return `<div class="empty-note item-empty">${L`Ничего не найдено. Очисти поиск`}
    <button class="btn btn-sm" data-clear-search>${L`Очистить`}</button></div>`;
}

function bindClearSearch(grid, input, clear) {
  grid.querySelector('[data-clear-search]')?.addEventListener('click', () => {
    input.value = '';
    clear();
    input.focus();
  });
}

/** The options the search leaves, the hero's own item first: choosing it is how a pick comes off. */
function paintItemOptions() {
  const st = itemSlotModalState;
  const data = cat.slotData(st.slot);
  const all = [{ id: '', name: L`Стандартный`, tags: [] }, ...data.options];
  const q = String(st.query || '').trim().toLowerCase();
  const options = q ? all.filter((o) => o.name.toLowerCase().includes(q)) : all;
  const grid = $('#itemPickGrid');
  grid.innerHTML = options.length
    ? options.map((o, i) => itemSlotOptionCardHtml(st.slot, o, i)).join('')
    : emptySearchHtml();
  bindClearSearch(grid, $('#itemSlotSearch'), () => { st.query = ''; paintItemOptions(); syncItemSlotModal(); });
  itemSlotPickerIo?.disconnect();
  paintCosmeticIcons(grid);
  itemSlotPickerIo = watchCosmeticIcons(grid, null);
}

// What is chosen and what is on, marked in place: drawing the cards again would play their
// entrance once more on every click.
function syncItemSlotModal() {
  const st = itemSlotModalState;
  const data = cat.slotData(st.slot);
  if (!data || !$('#itemPickFoot')) return;
  const live = pickedIn(st.slot);
  const hasItem = !!st.selectedId;
  $('#itemPickGrid').querySelectorAll('[data-item-option]').forEach((card) => {
    const id = card.dataset.itemOption;
    const on = id ? live?.itemId === id : !live;
    card.classList.toggle('picked', id === st.selectedId);
    card.classList.toggle('installed', on);
    card.setAttribute('aria-pressed', String(id === st.selectedId));
    card.querySelector('.card-meta span').innerHTML = on ? L`Надето` : esc(card.dataset.tags) || '&nbsp;';
  });
  const fx = $('#effectGrid');
  if (fx) {
    fx.querySelectorAll('[data-effect-id], [data-effect-none]').forEach((card) => {
      const chosen = card.dataset.effectId ? st.effectIds.includes(card.dataset.effectId) : !st.effectIds.length;
      card.classList.toggle('picked', hasItem && chosen);
      card.setAttribute('aria-pressed', String(hasItem && chosen));
      card.disabled = !hasItem;
    });
    $('#itemFxHint').textContent = hasItem
      ? L`Можно выбрать несколько. Иней и Снег держатся не на всех моделях.`
      : L`Эффект добавляется к предмету: сначала выбери его выше.`;
  }
  const chosen = hasItem ? data.options.find((o) => o.id === st.selectedId) : null;
  const names = (data.effects || []).filter((e) => e.id && st.effectIds.includes(e.id)).map((e) => e.name);
  const summary = `<b>${esc(chosen ? chosen.name : L`Стандартный`)}</b>${chosen && names.length ? ` · ${esc(names.join(', '))}` : ''}`;
  const act = stagedItemAction(data, live, st);
  $('#itemPickFoot').innerHTML = builderFootHtml(summary, act);
  $('#itemApplyBtn').addEventListener('click', () => applyItemSlot(act, chosen));
}

async function applyItemSlot(act, chosen) {
  const st = itemSlotModalState;
  if (!st || act.off || (!act.remove && !chosen)) return;
  const data = cat.slotData(st.slot);
  st.busy = true;
  syncItemSlotModal();
  try {
    await cat.pickCosmetic(st.slot, act.remove ? { id: '', name: L`Стандартный` } : chosen, !!act.remove, effectKey(data, st.effectIds));
  } finally {
    st.busy = false;
    if (itemSlotModalState === st) syncItemSlotModal();
  }
}

export async function renderItemCosmeticHub(restoreScrollTop = null) {
  await paint(() => { viewRoot.innerHTML = `<div class="view-header"><h1 class="view-title">${esc(catName(COSMETIC_PREFIX + 'items'))}</h1></div><div class="empty-note">${L`Читаем схему игры…`}</div>`; });
  if (!state.cosmeticSlots) await refreshCosmeticSlots();
  if (state.activeCategory !== COSMETIC_PREFIX + 'items') return;

  const heroes = new Map();
  for (const s of itemCosmeticSlots()) {
    const key = s.heroLabel || s.label || s.slot;
    if (!heroes.has(key)) heroes.set(key, []);
    heroes.get(key).push(s);
  }
  const list = [...heroes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  await loadHeroPortraits(list);
  if (!list.length) {
    await paint(() => { viewRoot.innerHTML = `<div class="view-header"><h1 class="view-title">${esc(catName(COSMETIC_PREFIX + 'items'))}</h1></div><div class="empty-note">${L`Схема игры не прочиталась — проверь путь к Dota 2 в настройках.`}</div>`; });
    return;
  }

  const paintHub = (filteredList) => {
    const count = filteredList.length;
    $('#cosCount').textContent = (cat.search() || cat.filters().installedOnly)
      ? `${count} ${plural(count, 'герой', 'героя', 'героев')}`
      : '';
    $('#itemHub').innerHTML = filteredList.length
      ? `<div class="grid">${filteredList.map(([hero, slots], i) => itemHeroCardHtml(hero, slots, i)).join('')}</div>`
      : `<div class="empty-note">${L`Ничего не найдено — сбрось фильтры`}</div>`;
    viewRoot.querySelectorAll('[data-item-hero]').forEach((btn) => {
      const heroName = btn.dataset.itemHero;
      const heroSlots = heroes.get(heroName) || [];
      btn.addEventListener('click', () => openItemHeroModal(heroName, heroSlots, btn));
    });
    itemHubIo?.disconnect();
    itemHubIo = null;
    paintCosmeticIcons($('#itemHub'));
    itemHubIo = watchCosmeticIcons($('#itemHub'), null);
  };

  const applyHubFilters = () => {
    const q = cat.search().trim().toLowerCase();
    const filtered = list.filter(([hero, slots]) => {
      if (q && !hero.toLowerCase().includes(q)) return false;
      if (cat.filters().installedOnly && !slots.some((s) => pickedIn(s.slot))) return false;
      return true;
    });
    paintHub(filtered);
  };

  await paint(() => { viewRoot.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">${esc(catName(COSMETIC_PREFIX + 'items'))}</h1>
    </div>
    <div class="toolbar">
      <div class="tb-line">
        <div class="tb-search cat-search"><span class="ms">search</span><input type="text" id="cosSearch" placeholder="${L`Поиск…`}" value="${esc(cat.search())}" autocomplete="off"></div>
        <div class="sep"></div>
        <button class="fchip ${cat.filters().installedOnly ? 'active' : ''}" id="cosInstalledChip"><span class="ms">check_circle</span>${L`Надетые`}</button>
        <span class="count" id="cosCount"></span>
      </div>
    </div>
    <div id="itemHub"></div>`; });

  cat.filters().favOnly = false;

  $('#cosSearch').addEventListener('input', (e) => { cat.setSearch(e.target.value); applyHubFilters(); });
  $('#cosInstalledChip').addEventListener('click', (e) => {
    cat.filters().installedOnly = !cat.filters().installedOnly;
    e.currentTarget.classList.toggle('active', cat.filters().installedOnly);
    applyHubFilters();
  });
  applyHubFilters();
  if (restoreScrollTop !== null && $('#main')) $('#main').scrollTop = restoreScrollTop;
}

// A hero's portrait, read out of the installed game (src/game-icons.ts heroPortraits): the game
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

function getHeroIconPath(label) {
  return heroPortraits.get(label) || null;
}

// The effects that have a picture. A fixed set, the same ids src/item-builder.ts offers, so the
// screen never has to ask what is in a folder.
const EFFECT_PICTURES = new Set(['bubbles', 'fire', 'frostbloom', 'ghost', 'lightnings', 'sand-storm', 'snow']);

function getEffectIconPath(effectId) {
  return EFFECT_PICTURES.has(effectId) ? `./assets/effects/${effectId}.webp` : null;
}

// What is on the hero, rather than how many slots it has: 92 of 124 heroes have four to six, so
// "5 slots" told nobody anything, and a dressed hero said only that it was dressed.
function heroCardMeta(hero, slots) {
  const sets = heroSets(hero);
  const worn = sets.find(setIsOn);
  if (worn) return esc(worn.name);
  const changed = slots.filter((s) => pickedIn(s.slot)).length;
  if (changed) return L`Изменено ${changed} из ${slots.length}`;
  return sets.length
    ? `${sets.length} ${plural(sets.length, 'набор', 'набора', 'наборов')}`
    : `${slots.length} ${plural(slots.length, 'слот', 'слота', 'слотов')}`;
}

function itemHeroCardHtml(hero, slots, i) {
  const hasInstalled = slots.some((s) => pickedIn(s.slot));
  const iconPath = getHeroIconPath(hero);
  return `
    <div class="card ${hasInstalled ? 'installed' : ''}" data-item-hero="${esc(hero)}" style="--i:${Math.min(i, 28)}">
      <div class="card-media">
        ${iconPath
          ? `<span class="card-thumb"><img src="${esc(iconPath)}" alt="" loading="lazy"></span>`
          : `<span class="card-thumb"><div class="noimg"><span class="ms">person</span></div></span>`}
      </div>
      <div class="card-body">
        <div class="card-name">${esc(hero)}</div>
        <div class="card-meta"><span>${heroCardMeta(hero, slots)}</span></div>
      </div>
    </div>`;
}

// ---------- sets: every piece of one, put on in one write (src/item-builder.ts itemSets) ----------

function heroSets(heroName) {
  return (state.cosmeticSets || []).filter((s) => s.heroLabel === heroName);
}

/** Each piece the builder puts on is on already, whatever effects it carries. */
function setIsOn(set) {
  return set.pieces.every((p) => !p.fits || pickedIn(p.slot)?.itemId === p.itemId);
}

function setTileHtml(sets) {
  const shown = sets.find(setIsOn) || sets[0];
  return `<button class="card item-slot-card ${sets.some(setIsOn) ? 'installed' : ''}" data-item-sets="true" style="--i:0">
    <div class="card-media">${cosmeticThumbSpanHtml(shown.name, 'inventory_2', 'item-slot-thumb')}</div>
    <div class="card-body">
      <div class="card-name">${L`Наборы`}</div>
      <div class="card-meta"><span>${sets.length} ${plural(sets.length, 'набор', 'набора', 'наборов')}</span></div>
    </div>
  </button>`;
}

function openItemHeroModal(heroName, slots, from) {
  cat.resetModalState();
  itemSlotModalState = null;
  itemSetState = null;
  itemSlotPickerIo?.disconnect();
  itemSlotPickerIo = null;
  cat.openModal(() => drawItemHeroModal(heroName, slots), from);
  const sets = heroSets(heroName);
  const firstVisible = [sets[0]?.name, ...slots.slice(0, 12).map((s) => pickedIn(s.slot)?.name || s.options[0]?.name)].filter(Boolean);
  loadCosmeticIcons(firstVisible, () => paintCosmeticIcons($('#modalContent')));
}

function drawItemHeroModal(heroName, slots) {
  const sets = heroSets(heroName);
  $('#modalContent').classList.remove('item-picker-modal');
  $('#modalContent').innerHTML = `
    <div class="modal-body">
      <div class="modal-title-row">
        <div class="modal-title">${esc(heroName)}</div>
        <button class="modal-close" id="modalCloseBtn" aria-label="${L`Закрыть`}"><span class="ms">close</span></button>
      </div>
      <div class="modal-sub">
        <span>${esc(catName(COSMETIC_PREFIX + 'items'))}</span>
        <span>· ${slots.length} ${plural(slots.length, 'слот', 'слота', 'слотов')}</span>
      </div>
      <div class="item-slot-grid item-hero-slots">
        ${sets.length ? setTileHtml(sets) : ''}
        ${slots.map((s) => itemSlotTileHtml(s)).join('')}
      </div>
    </div>`;
  $('#modalCloseBtn').addEventListener('click', () => cat.closeModal());
  $('#modalContent').querySelector('[data-item-sets]')?.addEventListener('click', () => openItemSetsModal({ heroName, slots }));
  $('#modalContent').querySelectorAll('[data-item-slot]').forEach((btn) => {
    btn.addEventListener('click', () => openItemSlotModal(btn.dataset.itemSlot, null,
      { back: { label: heroName, hero: true, go: () => openItemHeroModal(heroName, slots, null) } }));
  });
  paintCosmeticIcons($('#modalContent'));
}

/** A hero's sets. back: the hero window, which the header leads back to. */
function openItemSetsModal(back, query = '') {
  itemSlotModalState = null;
  itemSetState = { list: true, back, query };
  cat.resetModalState();
  cat.openModal(drawItemSetsModal, null);
  loadCosmeticIcons(heroSets(back.heroName).slice(0, 36).map((s) => s.name), () => {
    if (itemSetState?.list) paintCosmeticIcons($('#modalContent'));
  });
}

function setCardHtml(set, i) {
  const on = setIsOn(set);
  const n = set.pieces.length;
  // a line only where it tells something: 1914 of 1925 sets fit whole, and "5 pieces" on every
  // card said nothing
  const meta = on ? L`Надето` : set.fit < n ? L`${set.fit} из ${n}` : '&nbsp;';
  return `<button class="card item-pick-card ${on ? 'installed' : ''}" data-item-set="${esc(set.id)}" style="--i:${Math.min(i, 24)}">
    <div class="card-media">${cosmeticThumbSpanHtml(set.name, 'inventory_2')}</div>
    <div class="card-body">
      <div class="card-name">${esc(set.name)}</div>
      <div class="card-meta"><span>${meta}</span></div>
    </div>
  </button>`;
}

function drawItemSetsModal() {
  const st = itemSetState;
  const sets = heroSets(st.back.heroName);
  $('#modalContent').classList.add('item-picker-modal');
  $('#modalContent').innerHTML = `
    <div class="modal-body item-picker-body">
      ${builderHeadHtml(st.back.heroName, L`Наборы`, `<span>${sets.length} ${plural(sets.length, 'набор', 'набора', 'наборов')}</span>`)}
      <div class="tb-search item-picker-search"><span class="ms">search</span><input type="text" id="itemSetSearch" placeholder="${L`Поиск…`}" value="${esc(st.query)}" autocomplete="off"></div>
      <div class="item-pick-grid" id="itemSetGrid"></div>
    </div>`;
  const paintSets = () => {
    const q = st.query.trim().toLowerCase();
    const shown = q ? sets.filter((s) => [s.name, ...s.pieces.map((p) => p.name)].some((n) => n.toLowerCase().includes(q))) : sets;
    $('#itemSetGrid').innerHTML = shown.length
      ? shown.map(setCardHtml).join('')
      : emptySearchHtml();
    bindClearSearch($('#itemSetGrid'), $('#itemSetSearch'), () => { st.query = ''; paintSets(); });
    itemSlotPickerIo?.disconnect();
    paintCosmeticIcons($('#itemSetGrid'));
    itemSlotPickerIo = watchCosmeticIcons($('#itemSetGrid'), null);
  };
  $('#itemBackBtn').addEventListener('click', () => openItemHeroModal(st.back.heroName, st.back.slots, null));
  $('#modalCloseBtn').addEventListener('click', () => cat.closeModal());
  $('#itemSetSearch').addEventListener('input', (e) => { st.query = e.target.value; paintSets(); });
  $('#itemSetGrid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-item-set]');
    const set = card && sets.find((s) => s.id === card.dataset.itemSet);
    if (set) openItemSetModal(set, { ...st.back, query: st.query });
  });
  paintSets();
}

function openItemSetModal(set, back) {
  itemSetState = { set, back, busy: false };
  cat.resetModalState();
  cat.openModal(drawItemSetModal, null);
  loadCosmeticIcons(set.pieces.map((p) => p.name), () => {
    if (itemSetState?.set === set) paintCosmeticIcons($('#modalContent'));
  });
}

// A piece opens its slot's window with it chosen: a set brings no effects, and that is where they
// go on. A piece the builder cannot put on stays in the picture, dimmed, with why: it is part of
// what the set looks like, and without it "4 of 6" would not add up.
function pieceCardHtml(p, i) {
  const on = p.fits && pickedIn(p.slot)?.itemId === p.itemId;
  const meta = !p.fits ? esc(p.reason) : on ? `${esc(p.slotLabel)} · ${L`Надето`}` : esc(p.slotLabel);
  const tag = p.fits ? 'button' : 'div';
  return `<${tag} class="card item-pick-card item-piece ${p.fits ? '' : 'is-disabled'} ${on ? 'installed' : ''}"${p.fits ? ` data-piece="${i}"` : ''} style="--i:${Math.min(i, 24)}">
    <div class="card-media">${cosmeticThumbSpanHtml(p.name, 'checkroom')}</div>
    <div class="card-body">
      <div class="card-name">${esc(p.name)}</div>
      <div class="card-meta"><span>${meta}</span></div>
    </div>
  </${tag}>`;
}

function drawItemSetModal() {
  const st = itemSetState;
  const { set } = st;
  const n = set.pieces.length;
  const count = set.fit < n ? L`${set.fit} из ${n} ${plural(n, 'детали', 'деталей', 'деталей')}` : `${n} ${plural(n, 'деталь', 'детали', 'деталей')}`;
  const act = st.busy ? { label: L`Надеваю…`, icon: 'hourglass_top', off: true }
    : setIsOn(set) ? { label: L`Надето`, icon: 'check', off: true } : { label: L`Надеть весь набор`, icon: 'checkroom' };
  $('#modalContent').classList.add('item-picker-modal');
  $('#modalContent').innerHTML = `
    <div class="modal-body item-picker-body">
      ${builderHeadHtml(L`Наборы`, set.name, `<span>${esc(set.heroLabel)}</span><span>· ${count}</span>`)}
      <div class="item-pick-grid">${set.pieces.map(pieceCardHtml).join('')}</div>
      <div class="modal-note">${L`Набор надевается без эффектов. Чтобы добавить эффект, открой деталь.`}</div>
      <div class="item-picker-foot">${builderFootHtml(`<b>${esc(set.name)}</b> · ${count}`, act)}</div>
    </div>`;
  $('#itemBackBtn').addEventListener('click', () => openItemSetsModal(st.back, st.back.query || ''));
  $('#modalCloseBtn').addEventListener('click', () => cat.closeModal());
  $('#itemApplyBtn').addEventListener('click', () => applyItemSet(act));
  $('#modalContent').querySelectorAll('[data-piece]').forEach((card) => {
    const p = set.pieces[Number(card.dataset.piece)];
    // typed into the search, so the one card sits right above the effects
    card.addEventListener('click', () => openItemSlotModal(p.slot, null,
      { query: p.name, select: p.itemId, back: { label: set.name, go: () => openItemSetModal(set, st.back) } }));
  });
  paintCosmeticIcons($('#modalContent'));
}

async function applyItemSet(act) {
  const st = itemSetState;
  if (!st?.set || act.off) return;
  st.busy = true;
  drawItemSetModal();
  let r;
  try {
    r = await window.api.cosmetics.pickSet(st.set.id);
  } catch (err) {
    r = { error: String(err?.message || err) };
  }
  st.busy = false;
  if (r.error) toast(r.error, 'error');
  else toast(r.applied === r.pieces ? L`Надето: ${st.set.name}` : L`Надето ${r.applied} из ${r.pieces} ${plural(r.pieces, 'детали', 'деталей', 'деталей')}`);
  if (!r.error) await cat.afterPick();
  if (itemSetState === st) drawItemSetModal();
}

/** Stop watching the hub's icons: the catalog is drawing something else. */
export function forgetItemHub() {
  itemHubIo?.disconnect();
  itemHubIo = null;
}

/** Let go of an open builder window: another window is taking the overlay, or it closed. */
export function forgetItemSlotModal() {
  itemSlotPickerIo?.disconnect();
  itemSlotPickerIo = null;
  itemSlotModalState = null;
  itemSetState = null;
  $('#modalContent').classList.remove('item-picker-modal');
}

/** The rail's entry for the builder, when the game has items to build: '' otherwise. */
export function itemRailHtml(activeCategory) {
  if (!itemCosmeticSlots().length) return '';
  const id = COSMETIC_PREFIX + 'items';
  return `
        <button class="rail-item ${activeCategory === id ? 'active' : ''}" data-cat="${esc(id)}">
          <span class="ms">${catIcon(id)}</span>${esc(catName(id))}
          ${hasItemCosmeticPick() ? '<span class="rail-dot"></span>' : ''}
        </button>`;
}

/** Draw the hub again after a pick, where it was scrolled to, when it is the screen on show. */
export async function refreshItemHub() {
  if (state.view !== 'catalog' || state.activeCategory !== COSMETIC_PREFIX + 'items') return;
  await renderItemCosmeticHub($('#main')?.scrollTop || 0);
}

/** Mark the open item slot window again: its pick changed. */
export function redrawItemSlotModal() {
  if (itemSlotModalState) syncItemSlotModal();
}

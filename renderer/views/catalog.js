/* The Catalog: everything on offer, and the one screen that puts it on screen.
 *
 * Four lists share this file because they are one screen. The rail down the left, the
 * category grids, the mod modal that opens off a card, and the cosmetic slots the game's own
 * schema exposes - a slot is browsed as a category like any other, so the catalog draws it,
 * and its cards reuse the same markup, the same star and the same modal frame. Splitting
 * them apart would only mean two modules importing each other.
 *
 * What is offered comes from the upstream catalog (src/catalog.js via loadCatalog below),
 * which is why the mod index is built here: it is a reading of the same data.
 */
import { $ } from '../core/dom.js';
import { RAW_BASE, COSMETIC_PREFIX, cosmeticMeta, RAIL_SECTIONS, CATALOG_EXCLUDE, TOOLS_HIDDEN, SORTS, freshFilters } from '../core/constants.js';
import { state } from '../core/store.js';
import { registerView, render, pane } from '../core/router.js';
import { keyOf, pickedIn, refreshInstalledIndex, refreshCosmeticSlots } from '../core/installed.js';
import { catName, catIcon } from '../core/categories.js';
import { modCredits, CREDIT_ROLES } from '../core/credits.js';
import { creditChipsHtml, bindCreditChips } from '../ui/credit-chips.js';
import { esc, fmtDate, plural } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { previewUrl, isMedia, resolveUrl, mediaHtml } from '../ui/media.js';
import { openPlayer } from '../ui/player.js';
import { thumbHtml } from '../ui/thumb.js';
import { loadCosmeticIcons, paintCosmeticIcons, watchCosmeticIcons, cosmeticIcon, cosmeticIconKnown } from '../ui/cosmetic-icons.js';
import { paint } from '../ui/transitions.js';
import { isQueued, toggleQueued, dropFromQueue, useInstaller } from '../ui/queue.js';
import { refreshSidebarStatus } from '../ui/statusbar.js';
import { modGuidesHtml, bindGuides } from '../ui/guide.js';
import { refreshNotices, noticeBannerHtml, bindNotice } from '../ui/notice.js';
import { bindItemBuilder, itemRailHtml, isItemCosmeticSlot, cosmeticFavValue, renderItemCosmeticHub, refreshItemHub,
  forgetItemHub, forgetItemSlotModal, redrawItemSlotModal, openItemSlotModal } from './item-builder.js';
import { heroOf, heroMatches, heroGridWanted, renderHeroGrid, heroBackHtml, layoutToggleHtml, bindHeroControls } from './hero-grid.js';
import { staleTerrainPillHtml } from '../core/terrain-age.js';
import { shownMods, isAdult, adultShown } from '../core/adult.js';

const viewRoot = pane('catalog');

// This screen's own state, off the shared store now that it has somewhere to live.
let filters = freshFilters();   // sort + tag/group/hero/installed/starred narrowing
let cosSearch = '';             // search inside one cosmetic slot (its list runs to thousands)
const installing = new Set();   // mods with a download in flight, so a card can say so

registerView('catalog', () => renderCatalog());

// ---------- favorites ----------

const favKey = (cat, name) => `${cat}|${name}`;
const isFav = (cat, name) => state.favorites.has(favKey(cat, name));

async function toggleFavorite(cat, name) {
  const key = favKey(cat, name);
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.add(key);
  state.settings = await window.api.settings.set('favorites', [...state.favorites]);
  return state.favorites.has(key);
}

// starred mods resolved back to catalog entries (a mod dropped from the catalog is skipped)
function favoriteMods() {
  const out = [];
  for (const key of state.favorites) {
    if (key.startsWith(COSMETIC_PREFIX)) continue; // a look, not a mod — see favoriteCosmetics()
    const cut = key.indexOf('|');
    if (cut < 0) continue;
    const mod = findModByName(key.slice(0, cut), key.slice(cut + 1));
    if (mod && (adultShown() || !isAdult(mod))) out.push(mod);
  }
  return out;
}

// Cosmetics only work with the schema patch on, so with safe mode they are not offered
// anywhere — the rail, the favourites, the search all ask here first.
function cosmeticSlotList() {
  return state.settings?.schemaPatch ? (state.cosmeticSlots || []) : [];
}

function slotData(slot) {
  return cosmeticSlotList().find((s) => s.slot === slot) || null;
}

// one look, by the id the schema gave it or by its name (favourites are stored by name)
function findCosmetic(slot, idOrName) {
  const data = slotData(slot);
  if (!data) return null;
  return data.options.find((o) => o.id === idOrName) || data.options.find((o) => o.name === idOrName) || null;
}

// starred looks resolved back to slot + option (one Valve dropped is simply skipped)
function favoriteCosmetics() {
  const out = [];
  for (const key of state.favorites) {
    if (!key.startsWith(COSMETIC_PREFIX)) continue;
    const cut = key.indexOf('|');
    if (cut < 0) continue;
    const slot = key.slice(COSMETIC_PREFIX.length, cut);
    const o = findCosmetic(slot, key.slice(cut + 1));
    if (o) out.push({ slot, o });
  }
  return out;
}

// every look whose name matches, across all slots — the global search reaches these too
function searchCosmetics(q) {
  const out = [];
  for (const s of cosmeticSlotList()) {
    for (const o of s.options) {
      if (o.name.toLowerCase().includes(q)) out.push({ slot: s.slot, o });
    }
  }
  return out;
}

// the catalog sort/"installed only"/"starred only" filters, applied to a [{slot, o}] list
function filterCosmetics(list) {
  const f = filters;
  let out = f.installedOnly ? list.filter(({ slot, o }) => pickedIn(slot)?.itemId === o.id) : list;
  if (f.favOnly) out = out.filter(({ slot, o }) => isFav(COSMETIC_PREFIX + slot, cosmeticFavValue(slot, o)));
  if (f.sort === 'name') out = [...out].sort((a, b) => a.o.name.localeCompare(b.o.name));
  else if (f.sort === 'name-desc') out = [...out].sort((a, b) => b.o.name.localeCompare(a.o.name));
  return out;
}

// ---------- catalog data helpers ----------

// user-created packs live in localStorage
function customPacks() {
  try {
    return JSON.parse(localStorage.getItem('customPacks') || '[]');
  } catch {
    return [];
  }
}

function saveCustomPacks(packs) {
  localStorage.setItem('customPacks', JSON.stringify(packs));
}

function allCategoryMods(categoryId) {
  const data = state.catalog?.mods?.modsData?.[categoryId];
  if (!data) return [];
  if (Array.isArray(data)) {
    const mods = data
      .filter((m) => categoryId !== 'tools' || !TOOLS_HIDDEN.some((re) => re.test(m.name || '')))
      .map((m) => ({ ...m, _group: null }));
    if (categoryId === 'packs') {
      for (const p of customPacks()) {
        mods.push({ name: p.name, type: 'pack', mods: p.mods, _group: null, _custom: true });
      }
    }
    return mods;
  }
  if (data.groups) {
    const out = [];
    for (const g of data.groups) {
      for (const m of g.mods || []) out.push({ ...m, _group: g.name, _groupId: g.id });
    }
    return out;
  }
  return [];
}
// what browsing shows: without the adult mods until the user said yes (core/adult.js)
const categoryMods = (categoryId) => shownMods(allCategoryMods(categoryId));

function isGrouped(categoryId) {
  const data = state.catalog?.mods?.modsData?.[categoryId];
  return !!(data && !Array.isArray(data) && data.groups);
}

function visibleCategories() {
  const cats = state.catalog?.constants?.categories || [];
  return cats.filter((c) => !CATALOG_EXCLUDE.includes(c.id) && categoryMods(c.id).length);
}

function buildModIndex() {
  state.modIndex.clear();
  for (const c of state.catalog?.constants?.categories || []) {
    for (const m of allCategoryMods(c.id)) {
      if (m.name) state.modIndex.set(m.name.toLowerCase(), { categoryId: c.id, mod: m });
    }
  }
}

function installTarget(mod) {
  const f = mod.file;
  if (!f) return null;
  if (/\.(vpk|zip)$/i.test(f)) return f;
  return null;
}

/* Tags in the catalog answer two different questions, and only one of them is a filter you
 * flip. "What does this mod change" - effects, icons, sounds - can be true at once and stays
 * a chip. The rest of hero-items names the slot the item sits in: one answer at a time out of
 * fourteen, which as chips was a second toolbar under the first, six of them finding one mod
 * each. Heroes are already a dropdown for the same reason. */
const SLOT_TAGS = new Set(['weapon', 'shoulders', 'head', 'arms', 'arm', 'armor', 'back', 'mount', 'shield', 'totem', 'hair']);
// the catalog spells one slot both ways
const TAG_ALIAS = { arm: 'arms' };
export const canonTag = (t) => TAG_ALIAS[t] || t;

// Our own words for what the catalog ships in English. Keys are Russian, like everywhere
// else in the app, so tr() carries them into English by the same table as the rest.
const TAG_WORD = {
  effects: 'Эффекты', icons: 'Иконки', sounds: 'Звуки', anime: 'Аниме', adult: '18+',
  video: 'Видео', image: 'Картинка', lowres: 'Плохое качество',
  meta: 'Мета', stats: 'Статистика', fun: 'Развлечения', 'source-code': 'Исходный код',
  weapon: 'Оружие', shoulders: 'Наплечники', head: 'Голова', arms: 'Руки', armor: 'Броня',
  back: 'Спина', mount: 'Ездовое', shield: 'Щит', totem: 'Тотем', hair: 'Волосы',
};

function tagLabel(categoryId, tag) {
  const known = TAG_WORD[canonTag(tag)];
  if (known) return tr(known);
  // a tag we have never seen: the catalog's own label if it has one, else the raw key, and
  // either way it starts with a capital rather than looking like a leftover id
  const cfg = state.catalog?.constants?.TAG_CONFIGS?.[categoryId];
  const raw = String(cfg?.map?.[tag] || tag);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function isInstalled(categoryId, m) {
  return state.installedIndex.has(keyOf(categoryId, m.name, null)) ||
    (m.styles || []).some((s) => state.installedIndex.has(keyOf(categoryId, m.name, s.label)));
}

// can this mod ever carry the "Установлен" badge? (guides/sites are link-only)
function canBeInstalled(m) {
  return !!installTarget(m) || (m.styles || []).some((s) => s.file && /\.(vpk|zip)$/i.test(s.file));
}

// ---------- filtering / sorting ----------

// Chips: what the mod changes, commonest first. A chip that finds one mod today is kept -
// the catalog grows, and "which courier has effects" is worth asking even of a list of one.
function collectTags(mods) {
  const tags = new Map(); // tag -> count
  for (const m of mods) {
    for (const [k, v] of Object.entries(m.tags || {})) {
      if (v && !SLOT_TAGS.has(k)) tags.set(k, (tags.get(k) || 0) + 1);
    }
  }
  return [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

// The dropdown beside it: which slot the item goes in, A-Z by the word the user reads.
function collectSlots(mods, categoryId) {
  const seen = new Set();
  for (const m of mods) {
    for (const [k, v] of Object.entries(m.tags || {})) {
      if (v && SLOT_TAGS.has(k)) seen.add(canonTag(k));
    }
  }
  return [...seen].sort((a, b) => tagLabel(categoryId, a).localeCompare(tagLabel(categoryId, b)));
}

function collectGroups(mods) {
  const seen = new Set();
  const out = [];
  for (const m of mods) {
    if (m._group && !seen.has(m._group)) {
      seen.add(m._group);
      out.push(m._group);
    }
  }
  return out;
}

function applyFilters(mods, catForInstalled) {
  const f = filters;
  let out = mods;
  if (f.group) out = out.filter((m) => m._group === f.group);
  if (f.hero) out = out.filter((m) => heroMatches(f.hero, m.name));
  if (f.tags.size) {
    out = out.filter((m) => [...f.tags].every((t) => m.tags?.[t]));
  }
  if (f.slot) {
    out = out.filter((m) => Object.entries(m.tags || {}).some(([k, v]) => v && canonTag(k) === f.slot));
  }
  if (f.installedOnly) {
    out = out.filter((m) => isInstalled(m._cat || catForInstalled, m));
  }
  if (f.favOnly) {
    out = out.filter((m) => isFav(m._cat || catForInstalled, m.name));
  }
  const dateOf = (m) => m.meta?.date || 0;
  switch (f.sort) {
    case 'date': out = [...out].sort((a, b) => dateOf(b) - dateOf(a)); break;
    case 'name': out = [...out].sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'name-desc': out = [...out].sort((a, b) => b.name.localeCompare(a.name)); break;
  }
  return out;
}

function favButtonHtml(cat, name) {
  const on = isFav(cat, name);
  return `<button class="fav-btn ${on ? 'on' : ''}" data-fav="${esc(favKey(cat, name))}"
    aria-pressed="${on}" title="${on ? L`Убрать из избранного` : L`В избранное`}"
    aria-label="${on ? L`Убрать из избранного` : L`В избранное`}"><span class="ms">${on ? 'favorite' : 'favorite_border'}</span></button>`;
}

// media the built-in player can show: only a dedicated "preview"-type link.
// Mods whose card preview is itself a video already play it on hover/in the modal.
function modPreviewMedia(categoryId, mod) {
  const link = (mod.links || []).find((l) => l.type === 'preview' && isMedia(l.url));
  return link ? resolveUrl(link.url) : null;
}

// ===== Category rail =====

function renderRail() {
  const rail = $('#catRail');
  const cats = new Set(visibleCategories().map((c) => c.id));
  const favCount = favoriteMods().length + favoriteCosmetics().length;
  let html = `
    <button class="rail-item ${state.activeCategory === 'all' ? 'active' : ''}" data-cat="all">
      <span class="ms">apps</span>${L`Все категории`}
    </button>
    <button class="rail-item fav ${state.activeCategory === 'favorites' ? 'active' : ''}" data-cat="favorites">
      <span class="ms">favorite</span>${L`Избранное`}
      ${favCount ? `<span class="rail-cnt">${favCount}</span>` : ''}
    </button>`;
  for (const [label, ids] of RAIL_SECTIONS) {
    const present = ids.filter((id) => cats.has(id));
    if (!present.length) continue;
    html += `<div class="rail-section">${esc(tr(label))}</div>`;
    for (const id of present) {
      html += `
        <button class="rail-item ${state.activeCategory === id ? 'active' : ''}" data-cat="${esc(id)}">
          <span class="ms">${catIcon(id)}</span>${esc(catName(id))}
        </button>`;
    }
  }
  // Free cosmetics only work once safe mode is off (the patch is what lets the game read
  // them at all) — showing the section without that would just be a list of dead buttons.
  const cos = cosmeticSlotList();
  if (cos.length) {
    html += `<div class="rail-section">${L`Косметика`}</div>`;
    for (const s of cos.filter((x) => !isItemCosmeticSlot(x.slot))) { // the builder's slots have one entry of their own
      const id = COSMETIC_PREFIX + s.slot;
      html += `
        <button class="rail-item ${state.activeCategory === id ? 'active' : ''}" data-cat="${esc(id)}">
          <span class="ms">${catIcon(id)}</span>${esc(catName(id))}
          ${pickedIn(s.slot) ? '<span class="rail-dot"></span>' : ''}
        </button>`;
    }
    html += itemRailHtml(state.activeCategory);
  }
  rail.innerHTML = html;
  rail.querySelectorAll('.rail-item').forEach((b) => {
    b.addEventListener('click', () => {
      state.activeCategory = b.dataset.cat;
      filters = freshFilters();
      cosSearch = '';
      if (state.search) {
        state.search = '';
        $('#globalSearch').value = '';
        $('#clearSearch').classList.add('hidden');
      }
      renderCatalog();
    });
  });
}

// ===== Catalog =====

async function renderCatalog() {
  forgetItemHub();
  if (!state.catalog) {
    await paint(() => { viewRoot.innerHTML = `<div class="empty-note">${L`Загрузка каталога…`}</div>`; });
    return;
  }
  if (state.catalog.error) {
    /* Two failures that need different sentences.
     *
     * Not being able to open a socket is what happens when the wifi is off or the whole route
     * to the catalog is blocked, and it used to print "fetch failed" - Node's words, at a
     * player, on the screen where the mods should be. Anything else is a server that answered
     * with something, and telling that person to check their connection sends them to fix
     * what is not broken.
     *
     * Either way the app itself is fine and the mods already installed are still installed,
     * which is the part worth saying out loud on an otherwise empty screen. */
    const offline = state.catalog.offline;
    await paint(() => { viewRoot.innerHTML = `
      <div class="empty-note offline-note">
        <span class="ms offline-icon">${offline ? 'wifi_off' : 'cloud_off'}</span>
        <b>${offline ? L`Нет соединения с интернетом` : L`Каталог сейчас недоступен`}</b>
        <span>${offline
          ? L`Моды, которые уже стоят, работают. Каталог появится, как только связь вернётся.`
          : L`Моды, которые уже стоят, работают. Попробуй ещё раз через минуту.`}</span>
        <button class="btn btn-primary" id="retryCat">${L`Повторить`}</button>
        <span class="offline-detail">${esc(state.catalog.error)}</span>
      </div>`; });
    $('#retryCat').addEventListener('click', () => loadCatalog(true));
    return;
  }

  renderRail();
  await refreshNotices();

  const searching = state.search.trim().length > 0;
  if (searching) await renderSearchResults();
  else if (state.activeCategory === 'all') await renderHome();
  else if (state.activeCategory === 'favorites') await renderFavorites();
  else if (state.activeCategory.startsWith(COSMETIC_PREFIX)) await renderCosmeticCategory(state.activeCategory.slice(COSMETIC_PREFIX.length));
  else await renderCategory(state.activeCategory);
  // the no-game banner goes on last so it ends up on top: a user with no Dota has a more
  // pressing problem than whatever the network wanted to say
  showNoticeBanner();
  showNoGameBanner();
}

/* A notice that arrived from the network (see ui/notice.js). Prepended after the screen has
 * drawn, the same way the no-game banner is, so no category screen has to know about it. */
function showNoticeBanner() {
  const html = noticeBannerHtml();
  if (!html) return;
  const holder = document.createElement('div');
  holder.innerHTML = html;
  viewRoot.prepend(holder.firstElementChild);
  bindNotice(viewRoot, () => renderCatalog());
}

/* Without Dota there is a catalog and no way to install from it, and the only sign of that
 * used to be a grey line in the status bar - the news arrived as a refusal, after the click.
 * The banner says it before that, on whichever catalog screen the user is standing on, and
 * carries the two answers with it so nobody has to go looking through Settings.
 */
function showNoGameBanner() {
  if (state.settings?.dotaPathValid) return;
  const el = document.createElement('div');
  el.className = 'banner warn';
  el.innerHTML = `
    <span class="ms">warning</span>
    <div class="banner-body"><b>${L`Dota 2 не найдена`}</b>${L` — моды ставить некуда. Проверь, что игра установлена, или укажи её папку вручную.`}</div>
    <button class="btn btn-sm" id="findDotaBtn"><span class="ms">search</span>${L`Искать снова`}</button>
    <button class="btn btn-sm btn-primary" id="pickDotaBtn"><span class="ms">folder_open</span>${L`Указать папку`}</button>`;
  viewRoot.prepend(el);

  const settled = async (found) => {
    state.settings = await window.api.settings.get();
    await refreshSidebarStatus();
    if (found) toast(L`Dota 2 найдена — можно ставить моды`);
    renderCatalog();
  };
  $('#findDotaBtn').addEventListener('click', async () => {
    const found = await window.api.settings.detectDota();
    if (!found) { toast(L`Не нашёл автоматически — укажи папку вручную`, 'warn'); return; }
    settled(true);
  });
  $('#pickDotaBtn').addEventListener('click', async () => {
    const r = await window.api.settings.browseDota();
    if (r?.error) { toast(r.error, 'error', 6000); return; }
    if (r?.path) settled(true);
  });
}

// --- favorites ---

async function renderFavorites() {
  const all = favoriteMods();
  const mods = applyFilters(all);
  // starred looks live in the same list, kept in their own section: they install a slot of
  // the game's own schema rather than a file, so mixing them into the mod grid would lie
  const cosAll = favoriteCosmetics();
  const cos = filterCosmetics(cosAll);
  const installable = all.some(canBeInstalled) || cosAll.length > 0;
  const empty = !all.length && !cosAll.length;

  await paint(() => { viewRoot.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">${L`Избранное`}</h1>
    </div>
    ${empty ? '' : toolbarHtml(mods.length + cos.length, { installable, fav: false })}
    ${empty ? `<div class="empty-note">${L`Здесь пусто — жми на сердечко у мода в каталоге`}</div>` : ''}
    ${all.length ? `
      ${cosAll.length ? `<div class="section-h"><span class="ms">extension</span>${L`Моды`}</div>` : ''}
      <div class="grid" id="modGrid">
        ${mods.length ? mods.map((m, i) => cardHtml(m, i, { cat: true })).join('') : `<div class="empty-note">${L`Ничего не найдено — сбрось фильтры`}</div>`}
      </div>` : ''}
    ${cosAll.length ? `
      <div class="section-h spaced"><span class="ms">auto_awesome</span>${L`Косметика`}</div>
      <div class="grid" id="cosGrid">
        ${cos.length ? cos.map(({ slot, o }, i) => cosmeticCardHtml(slot, o, i, true)).join('') : `<div class="empty-note">${L`Ничего не найдено — сбрось фильтры`}</div>`}
      </div>` : ''}
  `; });
  if (!empty) bindToolbar();
  bindCards($('#modGrid'), mods);
  bindCosmeticCards($('#cosGrid'));
}

// --- home (all categories) ---

async function renderHome() {
  const cats = visibleCategories();
  const recent = (state.catalog.mods.recentlyAddedMods || [])
    .map((r) => {
      const hit = state.modIndex.get(r.name.toLowerCase());
      return hit && hit.categoryId === (r.category === 'effects-packs' ? 'ti-bp-effects' : r.category)
        ? { ...hit.mod, _cat: hit.categoryId }
        : (state.modIndex.get(r.name.toLowerCase()) ? { ...state.modIndex.get(r.name.toLowerCase()).mod, _cat: state.modIndex.get(r.name.toLowerCase()).categoryId } : null);
    })
    .filter((m) => m && (adultShown() || !isAdult(m)))
    .slice(0, 12);

  // No heading over any of it: the window says Каталог in the tab strip, and a title
  // repeating that would push the first mods below the fold to say nothing.
  await paint(() => { viewRoot.innerHTML = `
    ${recent.length ? `
      <div class="section-h"><span class="ms">new_releases</span>${L`Недавно добавленные`}</div>
      <div class="recent-row">${recent.map((m, i) => cardHtml(m, i, { cat: true })).join('')}</div>` : ''}
    <div class="section-h"><span class="ms">apps</span>${L`Категории`}</div>
    <div class="cat-tiles">
      ${cats.map((c, i) => {
        const prev = c.preview ? `${RAW_BASE}/assets/previews/categories/${encodeURIComponent(c.preview)}` : null;
        return `
        <div class="cat-tile" data-cat="${esc(c.id)}" style="--i:${Math.min(i, 24)}">
          ${prev ? mediaHtml(prev) : ''}
          <div class="ct-shade"></div>
          <div class="ct-label">
            <span class="ct-name">${esc(catName(c.id))}</span>
          </div>
        </div>`;
      }).join('')}
    </div>
  `; });

  viewRoot.querySelectorAll('.cat-tile').forEach((t) => {
    t.addEventListener('click', async () => {
      state.activeCategory = t.dataset.cat;
      filters = freshFilters();
      await renderCatalog(); // the grid has to exist before it can be scrolled to the top
      $('#main').scrollTop = 0;
    });
  });
  bindCards(viewRoot);
}

// --- search results ---

// how many looks a search shows before it just says how many more there are: a query like
// "loading" matches a couple of thousand of them
const COS_SEARCH_LIMIT = 120;

async function renderSearchResults() {
  const q = state.search.trim().toLowerCase();
  const cats = visibleCategories();
  let mods = [];
  for (const c of cats) {
    for (const m of categoryMods(c.id)) {
      if (m.name && m.name.toLowerCase().includes(q)) mods.push({ ...m, _cat: c.id });
    }
  }
  // the search reaches the free cosmetics too, in their own section below the mods
  const cosAll = searchCosmetics(q);
  // whether the "Установленные" chip makes sense at all — decided before filtering, or
  // the chip would vanish once it filtered everything out and could never be undone
  const installable = mods.some(canBeInstalled) || cosAll.length > 0;
  mods = applyFilters(mods);
  const cos = filterCosmetics(cosAll);
  const shownCos = cos.slice(0, COS_SEARCH_LIMIT);

  await paint(() => { viewRoot.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">${L`Поиск:`} <span class="accent">${esc(state.search.trim())}</span></h1>
    </div>
    ${toolbarHtml(mods.length + cos.length, { tags: [], groups: [], installable })}
    ${!mods.length && !cos.length ? `<div class="empty-note">${L`Ничего не найдено`}</div>` : ''}
    ${mods.length ? `
      ${cos.length ? `<div class="section-h"><span class="ms">extension</span>${L`Моды`}</div>` : ''}
      <div class="grid" id="modGrid">${mods.map((m, i) => cardHtml(m, i, { cat: true })).join('')}</div>` : ''}
    ${cos.length ? `
      <div class="section-h spaced"><span class="ms">auto_awesome</span>${L`Косметика`}</div>
      <div class="grid" id="cosGrid">${shownCos.map(({ slot, o }, i) => cosmeticCardHtml(slot, o, i, true)).join('')}</div>
      ${cos.length > shownCos.length ? `<div class="search-more">${L`…и ещё ${cos.length - shownCos.length} — уточни запрос`}</div>` : ''}` : ''}
  `; });
  bindToolbar();
  bindCards($('#modGrid'), mods);
  bindCosmeticCards($('#cosGrid'));
}

// --- single category ---

async function renderCategory(categoryId) {
  const all = categoryMods(categoryId).map((m) => ({ ...m, _cat: categoryId }));
  // the one category the catalog leaves flat, and the only one where the eye is looking for
  // a hero rather than reading 463 names in a row
  const byHero = categoryId === 'heroes';
  if (byHero) for (const m of all) m._group = heroOf(m.name);
  const tags = collectTags(all);
  const slots = collectSlots(all, categoryId);
  // hero dropdowns are long enough that catalog order is useless — sort them A-Z
  const groups = isGrouped(categoryId) ? collectGroups(all) : [];
  if (categoryId === 'hero-items') groups.sort((a, b) => a.localeCompare(b));
  const heroes = categoryId === 'heroes'
    ? (state.catalog?.constants?.HEROES_LIST || [])
      .filter((h) => all.some((m) => heroMatches(h, m.name)))
      .sort((a, b) => a.localeCompare(b))
    : [];
  const mods = applyFilters(all, categoryId);
  const installable = all.some(canBeInstalled);
  if (byHero && heroGridWanted(filters)) {
    await renderHeroGrid(viewRoot, catName(categoryId), toolbarHtml(mods.length, { tags, slots, heroes, categoryId, installable }), mods,
      { isInstalled, pick: (hero) => { filters.hero = hero; renderCatalog(); } });
    return bindToolbar();
  }

  // Picking one hero out of the dropdown already answers the question the headings answer,
  // so the grid stops repeating it.
  const grouped = (isGrouped(categoryId) || byHero) && !filters.group && !filters.hero && filters.sort === 'default';
  // hero groups are ours rather than the catalog's, so the order is ours to make: A-Z, with
  // the mod that names no hero at the end rather than in the middle of the alphabet
  if (grouped && byHero) mods.sort((a, b) => (a._group ? 0 : 1) - (b._group ? 0 : 1) || a._group.localeCompare(b._group));

  let gridHtml = '';
  if (!mods.length) {
    gridHtml = `<div class="empty-note">${L`Ничего не найдено — сбрось фильтры`}</div>`;
  } else if (grouped) {
    let lastGroup = null;
    mods.forEach((m, i) => {
      if (m._group !== lastGroup) {
        gridHtml += `<div class="group-title">${esc(m._group || tr('Прочее'))}</div>`;
        lastGroup = m._group;
      }
      gridHtml += cardHtml(m, i);
    });
  } else {
    gridHtml = mods.map((m, i) => cardHtml(m, i)).join('');
  }

  await paint(() => { viewRoot.innerHTML = `
    <div class="view-header">
      ${byHero && filters.hero ? heroBackHtml() : ''}<h1 class="view-title">${esc((byHero && filters.hero) || catName(categoryId))}</h1>
    </div>
    ${toolbarHtml(mods.length, { tags, slots, groups, heroes, categoryId, installable })}
    <div class="grid" id="modGrid">${gridHtml}</div>
  `; });
  bindToolbar();
  bindCards(viewRoot, mods);
}

// --- toolbar ---

const GROUP_LABEL = { 'hero-items': 'Все герои', 'item-effects': 'Все предметы', creeps: 'Все крипы', towers: 'Все башни', 'creep-deny': 'Все типы' };

// Is the list in front of you shorter than the category itself? That, and only that, is when
// a number of results is worth printing: it answers "did that chip do anything". Sorting is
// not narrowing - the same mods come back in another order - so it does not count.
function narrowed() {
  const f = filters;
  return !!(f.tags.size || f.slot || f.installedOnly || f.favOnly || f.group || f.hero || state.search.trim());
}

// Two lines, on purpose. The top one is how to look at the category - what order, whose
// heroes, which slot, and the two answers about your own library - and it is the same
// everywhere. Tags belong to this category alone, so they sit under it, quieter. Nothing
// folds any more: the longest row left is four chips, now that slots are a dropdown.
function toolbarHtml(resultCount, { tags = [], slots = [], groups = [], heroes = [], categoryId = null, installable = true, fav = true }) {
  const f = filters;
  return `
    <div class="toolbar">
      <div class="tb-line">
        <div class="select-wrap">
          <span class="ms">sort</span>
          <select id="sortSelect">
            ${SORTS.map((s) => `<option value="${s.key}" ${f.sort === s.key ? 'selected' : ''}>${esc(tr(s.label))}</option>`).join('')}
          </select>
        </div>
        ${heroes.length ? `
          <div class="select-wrap">
            <span class="ms">person</span>
            <select id="heroSelect">
              <option value="">${L`Все герои`}</option>
              ${heroes.map((h) => `<option value="${esc(h)}" ${f.hero === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
            </select>
          </div>` : ''}
        ${groups.length ? `
          <div class="select-wrap">
            <span class="ms">${categoryId === 'hero-items' ? 'person' : catIcon(categoryId) || 'group'}</span>
            <select id="groupSelect">
              <option value="">${esc(tr(GROUP_LABEL[categoryId] || 'Все группы'))}</option>
              ${groups.map((g) => `<option value="${esc(g)}" ${f.group === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
            </select>
          </div>` : ''}
        ${slots.length ? `
          <div class="select-wrap">
            <span class="ms">checkroom</span>
            <select id="slotSelect">
              <option value="">${L`Все слоты`}</option>
              ${slots.map((s) => `<option value="${esc(s)}" ${f.slot === s ? 'selected' : ''}>${esc(tagLabel(categoryId, s))}</option>`).join('')}
            </select>
          </div>` : ''}
        ${installable || fav ? '<div class="sep"></div>' : ''}
        ${installable ? `
        <button class="fchip ${f.installedOnly ? 'active' : ''}" id="installedChip">
          <span class="ms">check_circle</span>${L`Установленные`}
        </button>` : ''}
        ${fav ? `
        <button class="fchip ${f.favOnly ? 'active' : ''}" id="favChip">
          <span class="ms">favorite</span>${L`Избранное`}
        </button>` : ''}
        ${categoryId === 'heroes' ? layoutToggleHtml() : ''}
        ${narrowed() ? `<span class="count">${resultCount} ${plural(resultCount, 'результат', 'результата', 'результатов')}</span>` : ''}
      </div>
      ${tags.length ? `
        <div class="tb-line tb-tags">
          ${tags.map((tag) => `
            <button class="fchip ${f.tags.has(tag) ? 'active' : ''}" data-tag="${esc(tag)}">
              ${esc(tagLabel(categoryId, tag))}
            </button>`).join('')}
        </div>` : ''}
    </div>`;
}

function bindToolbar() {
  bindHeroControls(() => { filters.hero = ''; renderCatalog(); });
  $('#sortSelect')?.addEventListener('change', (e) => {
    filters.sort = e.target.value;
    renderCatalog();
  });
  $('#groupSelect')?.addEventListener('change', (e) => {
    filters.group = e.target.value;
    renderCatalog();
  });
  $('#heroSelect')?.addEventListener('change', (e) => {
    filters.hero = e.target.value;
    renderCatalog();
  });
  $('#slotSelect')?.addEventListener('change', (e) => {
    filters.slot = e.target.value;
    renderCatalog();
  });
  $('#installedChip')?.addEventListener('click', () => {
    filters.installedOnly = !filters.installedOnly;
    renderCatalog();
  });
  $('#favChip')?.addEventListener('click', () => {
    filters.favOnly = !filters.favOnly;
    renderCatalog();
  });
  document.querySelectorAll('.fchip[data-tag]').forEach((c) => {
    c.addEventListener('click', () => {
      const t = c.dataset.tag;
      if (filters.tags.has(t)) filters.tags.delete(t);
      else filters.tags.add(t);
      renderCatalog();
    });
  });
}

// --- cards ---

/* Which look of a mod the grid is showing. Picked on the card itself, because that is where
 * the question comes up: scrolling past a mod in three colours, the one you want to see is
 * not always the one the catalog lists first, and opening the window to find out is a detour.
 * The site this catalog comes from works the same way and keeps the choice; here it lasts the
 * session, which is as long as a grid does. */
const pickedStyle = new Map(); // "cat|name" -> index

const styleKey = (cat, name) => `${cat}|${name}`;

function styleIndex(cat, mod) {
  const i = pickedStyle.get(styleKey(cat, mod.name)) || 0;
  return mod.styles && i < mod.styles.length ? i : 0;
}

/** The look the card is standing on: its own file, picture and name inside the catalog. */
function shownStyle(cat, mod) {
  return mod.styles ? mod.styles[styleIndex(cat, mod)] : null;
}

/* Which mods can go in the install list. Guides and tools are not mods, a pack is a list
 * already, and two categories only allow a handful of theirs - all of which the catalog says
 * itself in addToCartRules, the same rules its own site follows. */
function canQueue(cat, mod) {
  const rules = state.catalog?.constants?.addToCartRules || {};
  if ((rules.hiddenCategories || []).includes(cat)) return false;
  if (mod.type === 'guide' || mod.type === 'pack') return false;
  const allowed = rules.allowedMods?.[cat];
  if (allowed && !allowed.some((n) => String(n).toLowerCase() === mod.name.toLowerCase())) return false;
  return canBeInstalled(mod);
}

/** What the list needs to know about a mod: the look on show, not the mod in general. */
function queueEntry(cat, mod) {
  const style = shownStyle(cat, mod);
  return {
    key: keyOf(cat, mod.name, style?.label || null),
    cat,
    catName: catName(cat),
    name: mod.name,
    label: style?.label || null,
    title: style?.label ? `${mod.name} · ${style.label}` : mod.name,
    file: style?.file || mod.file,
    preview: previewUrl(cat, style?.preview || mod.preview),
  };
}

// A card is its picture. Everything else on it has to earn the room it takes, so what shows
// depends on the list: a grid inside one category needs neither the category's own name nor
// a date, while a search result and the "recently added" strip have to say where the mod
// was found. Not even the recent strip prints its date - the strip's own heading already
// says these are the new ones, and the modal has the date for anyone who wants it.
function cardHtml(m, i, { cat: withCat = false } = {}) {
  const cat = m._cat;
  const style = shownStyle(cat, m);
  // the badge answers for the look on show, not for "one of these is installed somewhere"
  const installed = style
    ? state.installedIndex.has(keyOf(cat, m.name, style.label))
    : isInstalled(cat, m);
  const author = m.author || m.sender;
  // built up rather than left as an empty row: a grid that shows none of these would
  // otherwise hold a line of nothing open under every name
  const meta = [
    withCat ? `<span>${esc(catName(cat))}</span>` : '',
    author ? `<span class="author-chip"><span class="ms">person</span>${esc(author)}</span>` : '',
  ].join('');
  return `
    <div class="card ${installed ? 'installed' : ''}" data-key="${esc(keyOf(cat, m.name, null))}" style="--i:${Math.min(i, 28)}">
      <div class="card-media">${cardMediaHtml(cat, m)}</div>
      <div class="card-body">
        <div class="card-name">${esc(m.name)}</div>
        ${cat === 'tools'
          ? toolMetaHtml(m, installed)
          : (meta ? `<div class="card-meta">${meta}</div>` : '')}
      </div>
    </div>`;
}

/* A tool says different things than a mod, so its line under the name says them: what the
 * card leads to on the left, and what comes with it on the right. This is the shape the
 * catalog's own site gives these cards, and there is no reason for ours to differ - the
 * pictures are the same pictures. An installed one drops the verb: the green frame and the
 * tick have already answered it. */
function toolMetaHtml(m, installed) {
  // the catalog hangs its safety warning on the tool as a guide; the author paints that one
  // red instead of calling it a guide, and it is the one thing worth reading before a download
  const unsafe = m.guideId === 'warning';
  const pills = [];
  if (!unsafe && (m.links || []).some((l) => l.type === 'source-code')) pills.push(`<span class="mtag soft">${L`Исходники`}</span>`);
  if (unsafe) pills.push(`<span class="mtag danger">${L`Небезопасно`}</span>`);
  else if (m.guideId && state.catalog?.guides?.[m.guideId]) pills.push(`<span class="mtag soft">${L`Гайд`}</span>`);

  /* One line, and 190px of it, so the pills are served first: a warning shortened to "НЕБЕЗ..."
   * is worse than no warning at all. The warning takes the row on its own, and the verb goes
   * as soon as two pills are there - the window repeats the verb in full and does not repeat
   * the pills. Measured in both languages: Russian runs the longer of the two here. */
  const verb = installed || pills.length > 1 || unsafe
    ? '' : (installTarget(m) ? tr('Скачать') : tr('Открыть'));
  if (!verb && !pills.length) return '';
  return `
    <div class="card-meta card-meta-split">
      ${verb ? `<span>${esc(verb)}</span>` : ''}
      ${pills.length ? `<span class="card-pills">${pills.join('')}</span>` : ''}
    </div>`;
}

// Everything inside the picture. Split out because switching a look redraws exactly this and
// nothing else: rebuilding the grid would restart every card's entrance and lose the scroll.
function cardMediaHtml(cat, m) {
  const style = shownStyle(cat, m);
  const prev = previewUrl(cat, style?.preview || m.preview);
  const installed = style
    ? state.installedIndex.has(keyOf(cat, m.name, style.label))
    : isInstalled(cat, m);
  const isPack = m.type === 'pack';
  // a tool that is only a link says so under its name, in the row that also carries its
  // pills - saying it twice would cost the picture a chip for nothing
  const external = !installTarget(m) && !m.styles && !isPack && cat !== 'tools';
  // Two, not three. The row is one line now (see .media-tags), and a third chip only ever
  // arrived to be cut off: a 190px picture holding the looks as well has room for about two
  // words. Effects and icons come before the slot the item sits in - what a mod does is what
  // the eye is after while scrolling, and the slot is a dropdown above the grid anyway.
  const looks = m.styles ? Math.min(m.styles.length, 5) : 0;
  // Пак / Свой / Ссылка stand in the same row and are about the mod itself, so they are
  // counted first and the tags take what is left. Measured: the sites cards carry Ссылка and
  // two tags, and all three came out with an ellipsis through them.
  const badges = (isPack ? 1 : 0) + (m._custom ? 1 : 0) + (external ? 1 : 0);
  const room = Math.max(0, (looks > 2 ? 1 : 2) - badges);
  const tags = [...new Set(Object.entries(m.tags || {}).filter(([, v]) => v).map(([k]) => canonTag(k)))]
    .sort((a, b) => (SLOT_TAGS.has(a) ? 1 : 0) - (SLOT_TAGS.has(b) ? 1 : 0))
    .slice(0, room);
  const playable = modPreviewMedia(cat, m);
  const entry = canQueue(cat, m) && !installed ? queueEntry(cat, m) : null;
  const queuedNow = entry && isQueued(entry.key);
  return `
    ${mediaHtml(prev, { hoverPlay: true, fallbackIcon: catIcon(cat) })}
    <div class="card-actions">
      ${favButtonHtml(cat, m.name)}
      ${entry ? `
        <button class="card-add ${queuedNow ? 'on' : ''}" data-add="${esc(entry.key)}"
                title="${queuedNow ? L`В списке установки` : L`Добавить в список`}"
                aria-label="${queuedNow ? L`В списке установки` : L`Добавить в список`}">
          <span class="ms">${queuedNow ? 'check' : 'add'}</span>
        </button>` : ''}
    </div>
    ${playable ? `
      <button class="mtag-play" data-play="${esc(playable)}" data-title="${esc(m.name)}" aria-label="${L`Смотреть превью`}">
        <span class="ms">play_arrow</span>${L`Превью`}
      </button>` : ''}
    <div class="media-tags" style="--looks:${looks}">
      ${isPack ? `<span class="mtag">${L`Пак`}</span>` : ''}${staleTerrainPillHtml(cat, m)}
      ${m._custom ? `<span class="mtag custom">${L`Свой`}</span>` : ''}
      ${external ? `<span class="mtag">${L`Ссылка`}</span>` : ''}
      ${tags.map((t) => `<span class="mtag soft">${esc(tagLabel(cat, t))}</span>`).join('')}
    </div>
    ${m.styles ? `
      <div class="media-swatches">
        ${m.styles.slice(0, 5).map((s, si) => `
          <button class="swatch-dot ${si === styleIndex(cat, m) ? 'active' : ''}" data-style-dot="${si}"
                  style="background:${cssColor(s.color)}"
                  title="${esc(s.label || tr('Обычный'))}"
                  aria-label="${esc(s.label || tr('Обычный'))}"></button>`).join('')}
      </div>` : ''}`;
}

function bindCards(root, modsList) {
  if (!root) return;
  root.querySelectorAll('.card[data-key]').forEach((card) => {
    const key = card.dataset.key;
    const [cat, name] = key.split('|');
    const mod = (modsList && modsList.find((m) => keyOf(m._cat, m.name, null) === key)) || findModByName(cat, name);
    card.addEventListener('click', () => {
      if (mod) openModModal(mod._cat || cat, mod, card);
    });
    bindCardMedia(card, cat, mod);
  });
}

// The controls that live on the picture, bound to one card. Called again after a look is
// switched, because that redraws the picture and everything standing on it.
function bindCardMedia(card, cat, mod) {
  const fav = card.querySelector('.fav-btn');
  if (fav) bindFavButton(fav);

  // on the video itself rather than the card: the picture is redrawn when a look is switched
  // and its listeners go with it, where a listener on the card would pile up
  const v = card.querySelector('video[data-hoverplay]');
  if (v) {
    v.addEventListener('mouseenter', () => { v.play().catch(() => {}); });
    v.addEventListener('mouseleave', () => { v.pause(); });
  }
  const playBtn = card.querySelector('.mtag-play');
  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlayer(playBtn.dataset.play, playBtn.dataset.title);
    });
  }
  const add = card.querySelector('.card-add');
  if (add && mod) {
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      // the list repaints every plus on screen, this one included
      toggleQueued(queueEntry(cat, mod));
    });
  }
  card.querySelectorAll('[data-style-dot]').forEach((dot) => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!mod) return;
      pickedStyle.set(styleKey(cat, mod.name), Number(dot.dataset.styleDot));
      const media = card.querySelector('.card-media');
      media.innerHTML = cardMediaHtml(cat, mod);
      bindCardMedia(card, cat, mod);
    });
  });
}

// star button on a card or in the modal: flips the star without disturbing the grid,
// unless the Favorites view is open — there an unstarred mod has to leave the list
function bindFavButton(btn) {
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const key = btn.dataset.fav;
    const cut = key.indexOf('|');
    const on = await toggleFavorite(key.slice(0, cut), key.slice(cut + 1));
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('.ms').textContent = on ? 'favorite' : 'favorite_border';
    const label = on ? L`Убрать из избранного` : L`В избранное`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    if (state.view !== 'catalog') return;
    // in a list that IS the favourites, the card has to leave it
    if (state.activeCategory === 'favorites' || filters.favOnly) renderCatalog();
    else renderRail();
  });
}

function findModByName(cat, name) {
  if (cat === 'packs') {
    const custom = customPacks().find((p) => p.name === name);
    if (custom) return { ...custom, _cat: 'packs' };
  }
  const hit = state.modIndex.get(name.toLowerCase());
  return hit ? { ...hit.mod, _cat: hit.categoryId } : null;
}

// toggle "Установлен" badges on visible cards in place — keeps grid scroll position
function refreshCardBadges() {
  viewRoot.querySelectorAll('.card[data-key]').forEach((card) => {
    const [cat, name] = card.dataset.key.split('|');
    const mod = findModByName(cat, name);
    if (!mod) return;
    const style = shownStyle(cat, mod);
    const installed = style
      ? state.installedIndex.has(keyOf(cat, mod.name, style.label))
      : isInstalled(cat, mod);
    if (card.classList.contains('installed') === installed) return;
    // the whole card says it, so there is nothing to insert or remove - and an installed mod
    // can no longer be queued, so the plus goes with it
    card.classList.toggle('installed', installed);
    card.querySelector('.card-media').innerHTML = cardMediaHtml(cat, mod);
    bindCardMedia(card, cat, mod);
  });
}

// ---------- mod modal ----------

let modalState = null;

// The window opens where windows open, in the middle, and the picture arrives inside it. It
// used to fly out of the card it was clicked on, which meant the picture was travelling on
// its own clock while the window did something else, and it read as two things at once.
// Timings live in modal.css; the only number needed here is when the exit is over.
let closingTimer = null;

// read rather than repeated, so the stylesheet stays the one place the tempo is set - and so
// the system's reduced-motion setting, which flattens it to 1ms, is honoured for free
function exitMs() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--dur-base');
  return parseFloat(v) || 0;
}

/* Where the window comes from. A window that appears in the middle no matter what was
 * clicked is a window with no cause; one that grows out of the thing you pressed keeps the
 * two connected, the way Windows does it. The panel is centred by the overlay, so the only
 * thing the stylesheet needs is how far the card was from that centre. */
function openFrom(el) {
  const panel = $('#modalContent');
  if (!el) {
    panel.style.removeProperty('--from-x');
    panel.style.removeProperty('--from-y');
    return;
  }
  const r = el.getBoundingClientRect();
  panel.style.setProperty('--from-x', `${Math.round(r.left + r.width / 2 - window.innerWidth / 2)}px`);
  panel.style.setProperty('--from-y', `${Math.round(r.top + r.height / 2 - window.innerHeight / 2)}px`);
}

function openModal(draw, from) {
  const overlay = $('#modalOverlay');
  clearTimeout(closingTimer);
  overlay.classList.remove('closing');
  draw();
  openFrom(from);
  overlay.classList.remove('hidden');
}

function openModModal(categoryId, mod, from) {
  forgetItemSlotModal();
  cosModalState = null; // the two share one overlay
  // opens on the look the card was showing, which is the one the user was just looking at
  modalState = { categoryId, mod, styleIdx: styleIndex(categoryId, mod) };
  openModal(drawModal, from);
}

function closeModal() {
  const overlay = $('#modalOverlay');
  if (overlay.classList.contains('hidden')) return;
  overlay.classList.add('closing');
  clearTimeout(closingTimer);
  closingTimer = setTimeout(() => {
    // reopened while it was falling: that pass owns the overlay now
    if (!overlay.classList.contains('closing')) return;
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    $('#modalContent').innerHTML = '';
    modalState = null;
    cosModalState = null;
    forgetItemSlotModal();
  }, exitMs());
}

$('#modalOverlay').addEventListener('click', (e) => {
  if (e.target === $('#modalOverlay')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

const LINK_LABEL = {
  preview: 'Превью', source: 'Источник', author: 'Автор', bug: 'Баг', guide: 'Гайд',
  'source-code': 'Исходники',
};

// A style's colour comes from the catalog and goes into a custom property, so it has to be
// a colour and nothing else. Two mods ship a gradient there rather than a hex, which is why
// this passes anything a colour or gradient is made of and stops at the characters that
// would end the declaration and start another one.
function cssColor(v) {
  const s = String(v || '').trim();
  return /^[#\w(),.%\s-]+$/.test(s) ? s : 'transparent';
}

// Washes, rings and glows are mixed from the look's colour, and a mix needs a colour rather
// than a picture: two mods ship a two-stop gradient there. Its first stop stands in for the
// whole thing wherever a flat value is required; the dot on the card keeps the gradient.
function flatColor(v) {
  const s = String(v || '');
  const hex = (s.match(/#[0-9a-f]{3,8}\b/i) || [])[0];
  if (hex) return hex;
  return /gradient|[;{}]/i.test(s) || !s.trim() ? 'var(--md-primary)' : cssColor(s);
}

// A pack's `mods` entry is usually a mod-name string, but the catalog also ships
// entries shaped like { name, style } — treat both, or the modal crashes on open.
function packMemberName(entry) {
  return (typeof entry === 'string' ? entry : entry?.name || '').trim();
}

/* A tool is somebody else's program, so the window offers what you can do with a program
 * rather than what you can do with a mod: fetch it, start it, open the folder it went into,
 * throw it away. There is no switch anywhere - a tool sits in the app's own folder and the
 * game never looks at it. */
function toolActionsHtml(mod, rec, target, busy) {
  if (rec) {
    const relPath = rec.files?.[0]?.relPath || '';
    return `
      <button class="btn btn-primary" id="toolRunBtn" data-rel="${esc(relPath)}"><span class="ms">play_arrow</span>${L`Запустить`}</button>
      <button class="btn" id="toolFolderBtn" data-rel="${esc(relPath)}"><span class="ms">folder_open</span>${L`Папка`}</button>
      <button class="btn btn-danger" id="toolDeleteBtn"><span class="ms">delete</span>${L`Удалить`}</button>`;
  }
  if (target) {
    return `<button class="btn btn-primary" id="installBtn" ${busy ? 'disabled' : ''}><span class="ms">download</span>${busy ? L`Скачивание…` : L`Скачать`}</button>`;
  }
  return mod.file
    ? `<button class="btn" id="openLinkBtn"><span class="ms">open_in_new</span>${L`Открыть сайт`}</button>`
    : '';
}

function packMembers(mod) {
  return (mod.mods || [])
    .map(packMemberName)
    .filter(Boolean)
    .map((name) => ({ name, hit: state.modIndex.get(name.toLowerCase()) }));
}

function drawModal() {
  const { categoryId, mod, styleIdx } = modalState;
  const styles = mod.styles || null;
  const cur = styles ? styles[styleIdx] : mod;
  const fileRef = styles ? cur.file : mod.file;
  const target = fileRef && /\.(vpk|zip)$/i.test(fileRef) ? fileRef : null;
  const isPack = mod.type === 'pack';
  const isTool = categoryId === 'tools';
  const styleLabel = styles ? cur.label : null;
  const installedRec = state.installedIndex.get(keyOf(categoryId, mod.name, styleLabel));
  const busy = installing.has(keyOf(categoryId, mod.name, styleLabel));
  // What the catalog wrote about this mod reads here rather than on a screen of its own
  const guides = modGuidesHtml(mod);

  const links = mod.links || [];
  const playable = modPreviewMedia(categoryId, mod);
  const mediaUrl = previewUrl(categoryId, cur.preview || mod.preview);

  // everybody the catalog credits, not only the first author (core/credits.js says why)
  const credits = modCredits(mod, state.catalog?.constants);

  // people are credits above, not buttons: their "url" is a name, which opened as a 404
  const otherLinks = links.filter((l) => !(l.type === 'preview' && isMedia(l.url)) && !CREDIT_ROLES.includes(l.type));

  // pack contents (with per-session exclusions)
  if (isPack && !modalState.packExcluded) modalState.packExcluded = new Set();
  const members = isPack ? packMembers(mod) : [];
  const activeCount = isPack ? members.filter((x) => !modalState.packExcluded.has(x.name)).length : 0;

  $('#modalContent').innerHTML = `
    <div class="modal-media">
      ${mediaHtml(mediaUrl, { autoplay: true, fallbackIcon: catIcon(categoryId) })}
      <button class="modal-close" id="modalCloseBtn" aria-label="${L`Закрыть`}"><span class="ms">close</span></button>
      ${playable ? `
        <button class="preview-toggle" id="previewPlayBtn">
          <span class="ms">play_circle</span>${L`Смотреть превью`}
        </button>` : ''}
    </div>
    <div class="modal-body">
      <div class="modal-title-row">
        <div class="modal-title">${esc(mod.name)}</div>
        ${favButtonHtml(categoryId, mod.name)}
      </div>
      <div class="modal-sub">
        <span>${esc(catName(categoryId))}</span>
        ${mod._group ? `<span>· ${esc(mod._group)}</span>` : ''}
        ${mod._custom ? `<span>${L`· свой пак`}</span>` : ''}
        ${mod.meta?.date ? `<span>· ${fmtDate(mod.meta.date)}</span>` : ''}
        ${creditChipsHtml(credits)}
      </div>
      ${styles ? `
        <div class="style-row">
          ${styles.map((s, i) => `
            <button class="style-btn ${i === styleIdx ? 'active' : ''}" data-style="${i}" style="--c:${flatColor(s.color)}">
              ${esc(s.label || tr('Обычный'))}
            </button>`).join('')}
        </div>` : ''}
      ${isPack ? `
        <div class="pack-list">
          ${members.map((x) => {
            const excluded = modalState.packExcluded.has(x.name);
            const thumb = x.hit ? previewUrl(x.hit.categoryId, x.hit.mod.preview || x.hit.mod.styles?.[0]?.preview) : null;
            const inst = x.hit && isInstalled(x.hit.categoryId, x.hit.mod);
            return `
            <div class="pack-row ${excluded ? 'excluded' : ''} ${x.hit ? '' : 'missing'}" data-member="${esc(x.name)}">
              ${thumbHtml('pack-thumb', thumb)}
              <div class="pack-info">
                <div class="pack-mod-name">${esc(x.name)}</div>
                <div class="pack-mod-cat">${x.hit ? esc(catName(x.hit.categoryId)) : L`не найден в каталоге`}${inst ? L` · установлен` : ''}</div>
              </div>
              <button class="pack-x" data-toggle="${esc(x.name)}" aria-label="${excluded ? L`Вернуть` : L`Убрать`}">
                <span class="ms">${excluded ? 'add' : 'close'}</span>
              </button>
            </div>`;
          }).join('')}
        </div>
        <div class="pack-save-row">
          <input class="input" id="packSaveName" placeholder="${L`Название своего пака…`}" value="${mod._custom ? esc(mod.name) : ''}">
          <button class="btn btn-sm" id="packSaveBtn"><span class="ms">bookmark_add</span>${L`Сохранить пак`}</button>
          ${mod._custom ? `<button class="btn btn-sm btn-danger" id="packDeleteBtn">${L`Удалить пак`}</button>` : ''}
        </div>` : ''}
      <div class="modal-actions">
        ${isTool ? toolActionsHtml(mod, installedRec, target, busy) : ''}
        ${!isTool && isPack ? `<button class="btn btn-primary" id="installPackBtn" ${activeCount ? '' : 'disabled'}><span class="ms">download</span>${L`Установить пак (${activeCount})`}</button>` : ''}
        ${!isTool && !isPack && target ? (installedRec
          ? `<button class="btn btn-danger" id="uninstallBtn"><span class="ms">delete</span>${L`Удалить`}</button>`
          : `<button class="btn btn-primary" id="installBtn" ${busy ? 'disabled' : ''}><span class="ms">download</span>${busy ? L`Установка…` : L`Установить`}</button>`) : ''}
        ${!isTool && !isPack && !target && mod.file ? `<button class="btn" id="openLinkBtn"><span class="ms">open_in_new</span>${L`Открыть ссылку`}</button>` : ''}
      </div>
      ${guides}
      ${otherLinks.length ? `
        <div class="modal-links">
          ${otherLinks.map((l) => `<button class="btn btn-sm" data-link="${links.indexOf(l)}"><span class="ms">open_in_new</span>${esc(tr(LINK_LABEL[l.type] || l.type || 'Ссылка'))}</button>`).join('')}
        </div>` : ''}
      ${categoryId === 'fonts' ? `<div class="modal-note">${L`Шрифт ставится в файлы игры (game\\dota\\panorama\\fonts) — параметр запуска не нужен. Оригиналы сохраняются автоматически.`}</div>` : ''}
      ${categoryId === 'cursors' ? `<div class="modal-note">${L`Курсор ставится в game\\dota\\resource\\cursor — параметр запуска не нужен. Оригиналы сохраняются автоматически. Включать и выключать его можно в «Моих модах», но активным может быть только один курсор: новый выключит предыдущий.`}</div>` : ''}
    </div>
  `;

  $('#modalCloseBtn').addEventListener('click', closeModal);
  const favBtn = $('#modalContent .fav-btn');
  if (favBtn) bindFavButton(favBtn);

  $('#previewPlayBtn')?.addEventListener('click', () => openPlayer(playable, mod.name));

  bindCreditChips(document, credits, (url) => window.api.misc.openExternal(url));

  // pack interactions
  document.querySelectorAll('.pack-x').forEach((b) => {
    b.addEventListener('click', () => {
      const n = b.dataset.toggle;
      if (modalState.packExcluded.has(n)) modalState.packExcluded.delete(n);
      else modalState.packExcluded.add(n);
      drawModal();
    });
  });
  const packSaveBtn = $('#packSaveBtn');
  if (packSaveBtn) {
    packSaveBtn.addEventListener('click', () => {
      const name = $('#packSaveName').value.trim();
      if (!name) { toast(L`Введи название пака`, 'warn'); return; }
      const modNames = members.filter((x) => !modalState.packExcluded.has(x.name)).map((x) => x.name);
      if (!modNames.length) { toast(L`В паке не осталось модов`, 'warn'); return; }
      const packs = customPacks().filter((p) => p.name !== name && p.name !== (mod._custom ? mod.name : null));
      packs.push({ name, mods: modNames });
      saveCustomPacks(packs);
      toast(L`Пак «${name}» сохранён — он появился в категории Паки`);
      if (state.view === 'catalog' && state.activeCategory === 'packs') { closeModal(); renderCatalog(); }
    });
  }
  const packDeleteBtn = $('#packDeleteBtn');
  if (packDeleteBtn) {
    packDeleteBtn.addEventListener('click', async () => {
      if (!await confirmDialog(L`Удалить пак «${mod.name}»?`)) return;
      saveCustomPacks(customPacks().filter((p) => p.name !== mod.name));
      closeModal();
      renderCatalog();
    });
  }

  document.querySelectorAll('.style-btn').forEach((b) => {
    b.addEventListener('click', () => {
      modalState.styleIdx = Number(b.dataset.style);
      // the card behind the window is showing a look too; they agree from here on
      pickedStyle.set(styleKey(categoryId, mod.name), modalState.styleIdx);
      drawModal();
    });
  });

  $('#installBtn')?.addEventListener('click', () => doInstall(categoryId, mod, styleLabel, fileRef, cur.preview || mod.preview));
  const uninstallBtn = $('#uninstallBtn');
  if (uninstallBtn) {
    uninstallBtn.addEventListener('click', async () => {
      if (!await confirmDialog(L`Удалить «${mod.name}»?`)) return;
      const r = await window.api.mods.remove(installedRec.id);
      if (r.error) toast(r.error, 'error');
      else toast(L`${mod.name} удалён`);
      await refreshInstalledIndex();
      refreshCardBadges();
      drawModal();
    });
  }
  const packBtn = $('#installPackBtn');
  if (packBtn) packBtn.addEventListener('click', () => installPack(mod));
  $('#toolRunBtn')?.addEventListener('click', async (e) => {
    const r = await window.api.misc.runTool(e.currentTarget.dataset.rel);
    if (r.error) toast(r.error, 'error');
  });
  $('#toolFolderBtn')?.addEventListener('click', (e) => window.api.misc.openToolsFolder(e.currentTarget.dataset.rel));
  $('#toolDeleteBtn')?.addEventListener('click', async () => {
    if (!await confirmDialog(L`Удалить «${mod.name}»?`)) return;
    const r = await window.api.mods.remove(installedRec.id);
    if (r.error) toast(r.error, 'error');
    else toast(L`${mod.name} удалён`);
    await refreshInstalledIndex();
    refreshCardBadges();
    drawModal();
  });
  const openLinkBtn = $('#openLinkBtn');
  if (openLinkBtn) openLinkBtn.addEventListener('click', () => window.api.misc.openExternal(mod.file));
  bindGuides($('#modalContent'));
  otherLinks.forEach((l) => {
    const a = document.querySelector(`[data-link="${links.indexOf(l)}"]`);
    if (a) a.addEventListener('click', () => {
      const u = resolveUrl(l.url);
      if (u) window.api.misc.openExternal(u);
    });
  });
}

async function doInstall(categoryId, mod, styleLabel, fileRef, preview, { batch = false } = {}) {
  const k = keyOf(categoryId, mod.name, styleLabel);
  if (installing.has(k)) return;
  if (!state.settings?.dotaPathValid && categoryId !== 'tools') {
    toast(L`Сначала укажи путь к Dota 2 в настройках`, 'warn');
    return;
  }
  // Installing it here and now settles the question the list was holding open, so say that
  // before doing it rather than leaving a tick behind on a mod that is already in the game.
  if (!batch && isQueued(k)) {
    const go = await confirmDialog(
      L`«${mod.name}» уже в списке установки. Поставить сейчас? Из списка он пропадёт.`,
      // nothing is being destroyed here, so neither the word nor the red button belongs
      { okLabel: L`Установить`, danger: false },
    );
    if (!go) return { cancelled: true };
    dropFromQueue(k);
  }
  /* Dota reads one map archive, so a terrain replaces whatever is there. Ours is ordinary
   * housekeeping and passes without a word; another program's is not, and Minify puts its map
   * mods in exactly that file. Asked before the download rather than reported after it. */
  if (!batch && categoryId === 'terrains') {
    const maps = await window.api.mods.mapsOwner().catch(() => ({ present: false }));
    if (maps.present) {
      const go = await confirmDialog(
        maps.owner === 'minify'
          ? L`В папке карт лежит мод Minify. Ландшафт займёт тот же файл и заменит его — Dota читает только один. Продолжить?`
          : L`В папке карт уже лежит ландшафт, поставленный не через приложение. Он будет заменён — Dota читает только один файл карт. Продолжить?`,
        { okLabel: L`Заменить`, danger: false },
      );
      if (!go) return { cancelled: true };
    }
  }
  installing.add(k);
  if (modalState) drawModal();
  /* A channel can reject rather than answer, and then this line used to throw: `installing`
     kept the key, the button stayed on "Installing..." for as long as the window was open, and
     the only trace was an unhandled rejection in the log. That is how a broken mods:install
     read as a hang for two releases instead of as an error. Whatever went wrong, the button
     comes back and says something. */
  let r;
  try {
    r = await window.api.mods.install({ categoryId, name: mod.name, styleLabel, fileRef, preview });
  } catch (err) {
    r = { error: String(err?.message || err) };
  }
  installing.delete(k);
  if (r.error && !r.already) toast(`${mod.name}: ${r.error}`, 'error', 6000);
  else if (r.replaced?.length) toast(L`${mod.name} установлен — «${r.replaced.join(', ')}» выключен: курсор в игре может быть только один`, 'warn', 7000);
  // a tool is not installed into anything: it is downloaded, unpacked and waiting in a folder
  else if (!r.error) toast(categoryId === 'tools' ? L`${mod.name} готов` : L`${mod.name} установлен`);
  await refreshInstalledIndex();
  refreshCardBadges();
  if (modalState) drawModal();
  return r;
}

/* Install a list of mods one after another and report once at the end. Two things use this:
 * a pack from the catalog, and the list the user built themselves. Sequential on purpose -
 * these are downloads into the same folder, and a mod's pak slot depends on what is already
 * there, so they cannot be raced. */
async function installMany(entries) {
  let ok = 0, fail = 0, skip = 0;
  for (const { categoryId, mod, styleLabel, fileRef, preview } of entries) {
    if (!fileRef || !/\.(vpk|zip)$/i.test(fileRef)) { skip++; continue; }
    if (state.installedIndex.has(keyOf(categoryId, mod.name, styleLabel))) { skip++; continue; }
    const r = await doInstall(categoryId, mod, styleLabel, fileRef, preview, { batch: true });
    if (r?.ok) ok++;
    else if (r?.cancelled) skip++;
    else fail++;
  }
  await refreshInstalledIndex();
  render();
  return { ok, skip, fail };
}

async function installPack(pack) {
  const excluded = modalState?.packExcluded || new Set();
  const names = (pack.mods || []).map(packMemberName).filter((n) => n && !excluded.has(n));
  closeModal();
  const entries = [];
  let missing = 0;
  for (const name of names) {
    const hit = state.modIndex.get(name.toLowerCase());
    if (!hit) { missing++; continue; }
    const { categoryId, mod } = hit;
    // a mod with styles keeps everything per style — its file, its label and its picture
    const style = mod.file ? null : mod.styles?.[0];
    entries.push({
      categoryId,
      mod,
      styleLabel: style?.label || null,
      fileRef: mod.file || style?.file,
      preview: style?.preview || mod.preview,
    });
  }
  const { ok, skip, fail } = await installMany(entries);
  toast(L`Пак «${pack.name}»: установлено ${ok}, пропущено ${skip + missing}${fail ? L`, ошибок ${fail}` : ''}`, fail ? 'warn' : 'ok', 7000);
}

// The install list hands its contents back here, since this is where installing lives.
useInstaller(async (list) => {
  const entries = list
    .map(({ cat, name, label, file, preview }) => {
      const mod = findModByName(cat, name);
      return mod ? { categoryId: cat, mod, styleLabel: label, fileRef: file, preview } : null;
    })
    .filter(Boolean);
  const { ok, skip, fail } = await installMany(entries);
  toast(
    L`Список: установлено ${ok}${skip ? L`, пропущено ${skip}` : ''}${fail ? L`, ошибок ${fail}` : ''}`,
    fail ? 'warn' : 'ok',
    7000,
  );
});

// ===== Cosmetics: free looks taken from the game's own item schema, browsed as a catalog
// category like any other (see COSMETIC_SLOTS / cosmeticMeta near the top of the file) =====

// One card per look, styled exactly like a catalog mod card (same .card/.grid classes):
// a picture, a favourite star, and the same green edge on whichever one is live.
function cosmeticCardHtml(slot, o, i, withCat = false) {
  const cat = COSMETIC_PREFIX + slot;
  const icon = cosmeticIcon(o.name);
  const picked = pickedIn(slot)?.itemId === o.id;
  return `
    <div class="card ${picked ? 'installed' : ''}" data-cos="${esc(slot)}" data-cos-id="${esc(o.id)}" style="--i:${Math.min(i, 28)}">
      <div class="card-media">
        <span class="card-thumb" data-name="${esc(o.name)}">${icon
          ? `<img src="${esc(icon)}" alt="" loading="lazy">`
          : `<div class="noimg"><span class="ms">${cosmeticMeta(slot).icon}</span></div>`}</span>
        <div class="card-actions">${favButtonHtml(cat, cosmeticFavValue(slot, o))}</div>
      </div>
      <div class="card-body">
        <div class="card-name">${esc(o.name)}</div>
        ${withCat ? `<div class="card-meta"><span>${esc(catName(cat))}</span></div>` : ''}
      </div>
    </div>`;
}

// Cosmetic cards behave like mod cards: a click opens the look, it does not install it.
function bindCosmeticCards(root) {
  if (!root) return;
  root.querySelectorAll('.card .fav-btn').forEach((btn) => bindFavButton(btn));
  root.querySelectorAll('.card[data-cos]').forEach((card) => {
    card.addEventListener('click', () => openCosmeticModal(card.dataset.cos, card.dataset.cosId, card));
  });
  paintCosmeticIcons(root);
  return watchCosmeticIcons(root, null);
}

// mark the live look on visible cosmetic cards in place — same idea as refreshCardBadges()
// for mods, so a pick never costs the grid its scroll position
function refreshCosmeticBadges() {
  viewRoot.querySelectorAll('.card[data-cos]').forEach((card) => {
    const picked = pickedIn(card.dataset.cos)?.itemId === card.dataset.cosId;
    card.classList.toggle('installed', picked);
  });
}

// ---------- cosmetic modal (the mod modal's twin, same markup and classes) ----------

let cosModalState = null;
function openCosmeticModal(slot, itemId, from) {
  const o = findCosmetic(slot, itemId);
  if (!o) return;
  // a hero's item, found by the search or in favourites: the builder's window, with it typed in
  if (isItemCosmeticSlot(slot)) return openItemSlotModal(slot, from, { query: o.name });
  forgetItemSlotModal();
  modalState = null;
  cosModalState = { slot, o };
  openModal(drawCosmeticModal, from);
  // the picture may not have been fetched yet if the card was never scrolled into view
  if (!cosmeticIconKnown(o.name)) loadCosmeticIcons([o.name], () => { if (cosModalState?.o === o) drawCosmeticModal(); });
}

function drawCosmeticModal() {
  const { slot, o } = cosModalState;
  const meta = cosmeticMeta(slot);
  const data = slotData(slot);
  const live = pickedIn(slot);
  const isLive = live?.itemId === o.id;
  const icon = cosmeticIcon(o.name);
  const busy = installing.has(COSMETIC_PREFIX + slot + '|' + o.id + '|');

  $('#modalContent').innerHTML = `
    <div class="modal-media cos">
      ${icon
        ? `<img src="${esc(icon)}" alt="">`
        : `<div class="noimg"><span class="ms">${meta.icon}</span></div>`}
      <button class="modal-close" id="modalCloseBtn" aria-label="${L`Закрыть`}"><span class="ms">close</span></button>
    </div>
    <div class="modal-body">
      <div class="modal-title-row">
        <div class="modal-title">${esc(o.name)}</div>
        ${favButtonHtml(COSMETIC_PREFIX + slot, cosmeticFavValue(slot, o))}
      </div>
      <div class="modal-sub">
        <span>${esc(tr(meta.label))}</span>
        <span>· ${L`вид для стандартного предмета`}</span>
        ${data ? `<span>· ${data.options.length} ${plural(data.options.length, 'вариант', 'варианта', 'вариантов')}</span>` : ''}
      </div>
      <div class="modal-actions">
        ${isLive
          ? `<button class="btn btn-danger" id="cosRemoveBtn"><span class="ms">delete</span>${L`Убрать`}</button>`
          : `<button class="btn btn-primary" id="cosPickBtn" ${busy ? 'disabled' : ''}><span class="ms">download</span>${busy ? L`Установка…` : L`Установить`}</button>`}
      </div>
      <div class="modal-note">
        ${isLive
          ? L`Этот вид сейчас стоит в слоте «${tr(meta.label)}». Убрать — вернуть то, что даёт игра; включить обратно можно в «Моих модах».`
          : live
            ? L`На один слот — только один вид: этот заменит «${live.name}». Прошлый выбор останется в «Моих модах» выключенным.`
            : L`Вид подставляется в схему предметов игры — стандартный предмет просто рисуется как выбранный. Файлы модов это не трогает, и видно только тебе.`}
      </div>
    </div>`;

  $('#modalCloseBtn').addEventListener('click', closeModal);
  const favBtn = $('#modalContent .fav-btn');
  if (favBtn) bindFavButton(favBtn);
  $('#cosPickBtn')?.addEventListener('click', () => pickCosmetic(slot, o, false));
  $('#cosRemoveBtn')?.addEventListener('click', () => pickCosmetic(slot, o, true));
}

/**
 * Put a look on (or take the live one off) and repaint whatever is on screen.
 * @param {boolean} remove  true = back to what the game gives
 */
async function pickCosmetic(slot, o, remove, effectId = '') {
  const effect = isItemCosmeticSlot(slot) ? String(effectId || '') : '';
  const k = COSMETIC_PREFIX + slot + '|' + o.id + '|' + effect;
  if (installing.has(k)) return;
  const live = pickedIn(slot);
  installing.add(k);
  if (cosModalState) drawCosmeticModal();
  let r;
  try {
    r = remove
      ? (live ? await window.api.mods.remove(live.id) : { ok: true })
      : await window.api.cosmetics.pick(slot, o.id, o.name, effect);
  } catch (err) {
    r = { error: String(err?.message || err) };
  }
  installing.delete(k);
  if (r.error) { toast(r.error, 'error'); if (cosModalState) drawCosmeticModal(); redrawItemSlotModal(); return; }
  toast(remove ? L`Вернули как в игре` : isItemCosmeticSlot(slot) ? L`Надето: ${o.name}` : L`Выбрано: ${o.name}`);
  await afterCosmeticPick();
}

/** Everything a pick shows on: My mods' index, the badges, the rail's dot, the open window. */
async function afterCosmeticPick() {
  await refreshInstalledIndex();
  refreshCosmeticBadges();
  if (state.view === 'catalog') renderRail(); // the slot's "picked" dot
  await refreshItemHub();
  if (cosModalState) drawCosmeticModal();
  redrawItemSlotModal();
}

async function renderCosmeticCategory(slot) {
  if (slot === 'items') return renderItemCosmeticHub();
  const meta = cosmeticMeta(slot);
  await paint(() => { viewRoot.innerHTML = `<div class="view-header"><h1 class="view-title">${esc(tr(meta.label))}</h1></div><div class="empty-note">${L`Читаем схему игры…`}</div>`; });
  if (!state.cosmeticSlots) await refreshCosmeticSlots();
  if (state.activeCategory !== COSMETIC_PREFIX + slot) return; // moved on while reading

  const data = (state.cosmeticSlots || []).find((s) => s.slot === slot);
  if (!data) {
    await paint(() => { viewRoot.innerHTML = `<div class="view-header"><h1 class="view-title">${esc(tr(meta.label))}</h1></div><div class="empty-note">${L`Схема игры не прочиталась — проверь путь к Dota 2 в настройках.`}</div>`; });
    return;
  }

  const f = filters;
  let io = null;

  const filtered = () => {
    const q = cosSearch.trim().toLowerCase();
    let list = data.options.map((o) => ({ slot, o }));
    if (q) list = list.filter(({ o }) => o.name.toLowerCase().includes(q));
    return filterCosmetics(list);
  };

  const paintGrid = () => {
    const list = filtered();
    const shown = list.slice(0, 400); // search narrows the rest; nobody scrolls past this
    // same rule as the mod grid: a number only once the list in front of you is a subset
    const narrow = !!(cosSearch.trim() || f.installedOnly || f.favOnly);
    $('#cosCount').textContent = narrow
      ? `${list.length} ${plural(list.length, 'результат', 'результата', 'результатов')}`
      : '';
    const grid = $('#cosGrid');
    grid.innerHTML = shown.length
      ? shown.map(({ o }, i) => cosmeticCardHtml(slot, o, i)).join('')
      : `<div class="empty-note">${L`Ничего не найдено — сбрось фильтры`}</div>`;
    if (io) io.disconnect();
    io = bindCosmeticCards(grid);
  };

  await paint(() => { viewRoot.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">${esc(tr(meta.label))}</h1>
    </div>
    <div class="toolbar">
      <div class="select-wrap">
        <span class="ms">sort</span>
        <select id="cosSort">
          ${SORTS.filter((s) => s.key !== 'date').map((s) => `<option value="${s.key}" ${f.sort === s.key ? 'selected' : ''}>${esc(tr(s.label))}</option>`).join('')}
        </select>
      </div>
      <div class="tb-search cat-search"><span class="ms">search</span><input type="text" id="cosSearch" placeholder="${L`Поиск…`}" value="${esc(cosSearch)}" autocomplete="off"></div>
      <div class="sep"></div>
      <button class="fchip ${f.installedOnly ? 'active' : ''}" id="cosInstalledChip"><span class="ms">check_circle</span>${L`Установленные`}</button>
      <button class="fchip ${f.favOnly ? 'active' : ''}" id="cosFavChip"><span class="ms">favorite</span>${L`Избранное`}</button>
      <span class="count" id="cosCount"></span>
    </div>
    <div class="grid" id="cosGrid"></div>`; });

  $('#cosSort').addEventListener('change', (e) => { f.sort = e.target.value; paintGrid(); });
  $('#cosSearch').addEventListener('input', (e) => { cosSearch = e.target.value; paintGrid(); });
  $('#cosInstalledChip').addEventListener('click', (e) => {
    f.installedOnly = !f.installedOnly;
    e.currentTarget.classList.toggle('active', f.installedOnly);
    paintGrid();
  });
  $('#cosFavChip').addEventListener('click', (e) => {
    f.favOnly = !f.favOnly;
    e.currentTarget.classList.toggle('active', f.favOnly);
    paintGrid();
  });
  paintGrid();
}

const CATALOG_MAX_AGE = 30 * 60 * 1000;

export async function loadCatalog(force = false) {
  if (force) toast(L`Обновляю каталог…`);
  state.catalog = null;
  if (state.view === 'catalog') renderCatalog();
  state.catalog = await window.api.catalog.load(force);
  if (!state.catalog.error) buildModIndex();
  if (state.view === 'catalog') renderCatalog();
  // The list is on screen and it is yesterday's: say so once rather than pretend it is fresh
  // or throw the whole thing away, which is what an empty window during a GitHub outage is.
  if (state.catalog.stale) toast(L`Каталог не обновился, показан последний загруженный`, 'warn');
  else if (force && !state.catalog.error) toast(L`Каталог обновлён`);

  // cached catalog goes stale fast (new mods appear upstream) — refresh in the background
  if (!force && !state.catalog.error && Date.now() - (state.catalog.fetchedAt || 0) > CATALOG_MAX_AGE) {
    window.api.catalog.load(true).then((fresh) => {
      if (fresh.error) return;
      state.catalog = fresh;
      buildModIndex();
      if (state.view === 'catalog') renderCatalog();
    });
  }
}

// The item builder lives in views/item-builder.js and reaches the catalog only through this.
bindItemBuilder({ slotData, cosmeticSlotList, pickCosmetic, afterPick: afterCosmeticPick, openModal, closeModal, filters: () => filters,
  search: () => cosSearch, setSearch: (v) => { cosSearch = v; }, resetModalState: () => { modalState = null; cosModalState = null; } });

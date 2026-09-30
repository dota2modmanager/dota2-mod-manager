/* Heroes, opened on the heroes themselves.
 *
 * The category is 463 mods and the eye reads it as heroes, so it opens the way the game's own
 * hero grid does: one tile per hero, a click opens that hero's mods. The old flat list is kept
 * one click away (the grid/list switch in the toolbar) for whoever preferred it. Its own file
 * because renderer/views/catalog.js is at its size budget; the catalog calls in here and hands
 * over what it owns (the toolbar, the filters) rather than this reaching back.
 */
import { $ } from '../core/dom.js';
import { state } from '../core/store.js';
import { esc } from '../ui/format.js';
import { previewUrl, isMedia, resolveUrl } from '../ui/media.js';
import { paint } from '../ui/transitions.js';

/* Heroes arrives as one flat list of 463 mods and the eye reads it as heroes: 462 of them
 * carry a hero's name, 121 heroes in all, three mods each on average, and one mod names
 * nobody. Hero items are grouped this way by the catalog itself - this does the same for the
 * category that is not, from the same list of names the filter above it uses.
 *
 * Cached because it is 127 patterns against 463 names on every draw otherwise. */
let heroPatterns = null;
const heroByName = new Map();

export function heroOf(name) {
  if (heroByName.has(name)) return heroByName.get(name);
  if (!heroPatterns) {
    heroPatterns = (state.catalog?.constants?.HEROES_LIST || [])
      .map((h) => [h, new RegExp(`\\b${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')]);
  }
  const hit = heroPatterns.find(([, re]) => re.test(name));
  const hero = hit ? hit[0] : '';
  heroByName.set(name, hero);
  return hero;
}

export function heroMatches(hero, name) {
  const re = new RegExp(`\\b${hero.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(name);
}

// Grid or the old flat list: a choice somebody makes once, so it outlives the session. Kept in
// the window's own storage - it is how this screen looks, not anything the app has to know.
const LAYOUT_KEY = 'catalog.heroLayout';
function layout() {
  try { return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}
function setLayout(v) {
  try { localStorage.setItem(LAYOUT_KEY, v); } catch { /* the default then */ }
}

/** The grid, unless a hero is picked, a sort asks for mods in an order, or the list was chosen. */
export function heroGridWanted(filters) {
  return !filters.hero && filters.sort === 'default' && layout() === 'grid';
}

export function heroBackHtml() {
  return `
    <button class="btn btn-ghost btn-sm hero-back" id="heroBack">
      <span class="ms">arrow_back</span>${L`Все герои`}
    </button>`;
}

export function layoutToggleHtml() {
  const on = layout();
  return `
    <div class="layout-toggle" role="group" aria-label="${L`Вид`}">
      <button class="seg-btn ${on === 'grid' ? 'active' : ''}" data-layout="grid" title="${L`Сеткой героев`}" aria-label="${L`Сеткой героев`}">
        <span class="ms">grid_view</span>
      </button>
      <button class="seg-btn ${on === 'list' ? 'active' : ''}" data-layout="list" title="${L`Все моды списком`}" aria-label="${L`Все моды списком`}">
        <span class="ms">view_agenda</span>
      </button>
    </div>`;
}

/** The way back and the grid/list switch both end on the whole category, unpicked. */
export function bindHeroControls(showAll) {
  $('#heroBack')?.addEventListener('click', showAll);
  document.querySelectorAll('.layout-toggle [data-layout]').forEach((b) => {
    b.addEventListener('click', () => { setLayout(b.dataset.layout); showAll(); });
  });
}

// Portraits come out of the player's own game (src/game-icons.ts heroPortraits), keyed by the
// name the catalog prints. null means asked and not found, so the tile keeps its stand-in.
const heroArt = new Map();

async function loadHeroArt(names) {
  const want = names.filter((n) => !heroArt.has(n));
  if (!want.length) return;
  let got = {};
  try { got = await window.api.cosmetics.heroPortraitsByName(want); } catch { /* no game: stand-ins */ }
  for (const n of want) heroArt.set(n, got[n] || null);
}

function heroTileHtml(hero, list, i, isInstalled) {
  const art = heroArt.get(hero);
  // No portrait (no game found, or one of the newest heroes): the first of its mods' own
  // pictures stands in, which is still that hero and still not a grey box.
  const first = list[0];
  const stand = art ? null : previewUrl(first._cat, first.preview || first.styles?.[0]?.preview);
  const installed = list.some((m) => isInstalled(m._cat, m));
  return `
    <button class="hero-tile ${installed ? 'installed' : ''}" data-hero="${esc(hero)}" style="--i:${Math.min(i, 40)}"
            title="${esc(hero || tr('Прочее'))}">
      <span class="hero-art">
        ${art ? `<img src="${esc(art)}" alt="" loading="lazy">`
          : stand && !isMedia(stand) ? `<img src="${esc(resolveUrl(stand))}" alt="" loading="lazy" class="stand-in">`
            : '<span class="ms">person</span>'}
      </span>
      <span class="hero-count">${list.length}</span>
      ${installed ? '<span class="hero-installed ms" aria-hidden="true">check_circle</span>' : ''}
      <span class="hero-name">${esc(hero || tr('Прочее'))}</span>
    </button>`;
}

/**
 * Draw the grid for mods already narrowed by the toolbar, so a tag or Installed shows only the
 * heroes that still have something.
 * @param {HTMLElement} root
 * @param {string} title
 * @param {string} toolbar  the catalog's toolbar, drawn as it would be over the list
 * @param {object[]} mods   each with _group set to its hero ('' for none)
 * @param {{ isInstalled: Function, pick: (hero: string) => void }} ctx
 */
export async function renderHeroGrid(root, title, toolbar, mods, { isInstalled, pick }) {
  const byHero = new Map();
  for (const m of mods) {
    const h = m._group || '';
    if (!byHero.has(h)) byHero.set(h, []);
    byHero.get(h).push(m);
  }
  // A-Z, with the mods that name no hero last, as the grouped list has them
  const order = [...byHero.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
  await loadHeroArt(order.filter(Boolean));

  await paint(() => { root.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">${esc(title)}</h1>
    </div>
    ${toolbar}
    ${order.length
      ? `<div class="hero-grid" id="heroGrid">${order.map((h, i) => heroTileHtml(h, byHero.get(h), i, isInstalled)).join('')}</div>`
      : `<div class="empty-note">${L`Ничего не найдено — сбрось фильтры`}</div>`}
  `; });
  $('#heroGrid')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.hero-tile');
    if (!tile) return;
    // the mods no hero claims have no entry in the hero dropdown: they sit last in the list
    if (!tile.dataset.hero) setLayout('list');
    pick(tile.dataset.hero);
    $('#main')?.scrollTo({ top: 0 });
  });
}

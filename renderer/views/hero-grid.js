/* Heroes, opened on the heroes themselves.
 *
 * The category is 463 mods and the eye reads it as heroes, so it opens the way the game's own
 * hero grid does: one tile per hero, a click opens that hero's mods. The old flat list is kept
 * one click away (the grid/list switch in the toolbar) for whoever preferred it. This file
 * knows the heroes (who a mod belongs to, their portraits, grid or list); catalog/screen/
 * HeroGrid.tsx draws the tiles and the catalog hands it the list already narrowed.
 */
import { state } from '../core/store.js';
import { previewUrl, isMedia, resolveUrl } from '../ui/media.js';

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
export function heroLayout() {
  try { return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}
export function setHeroLayout(v) {
  try { localStorage.setItem(LAYOUT_KEY, v); } catch { /* the default then */ }
}

/** The grid, unless a hero is picked, a sort asks for mods in an order, or the list was chosen. */
export function heroGridWanted(filters) {
  return !filters.hero && filters.sort === 'default' && heroLayout() === 'grid';
}

// Portraits come out of the player's own game (src/game-icons.js heroPortraits), keyed by the
// name the catalog prints. null means asked and not found, so the tile keeps its stand-in.
const heroArt = new Map();

async function loadHeroArt(names) {
  const want = names.filter((n) => !heroArt.has(n));
  if (!want.length) return;
  let got = {};
  try { got = await window.api.cosmetics.heroPortraitsByName(want); } catch { /* no game: stand-ins */ }
  for (const n of want) heroArt.set(n, got[n] || null);
}

/**
 * One tile per hero for mods already narrowed by the toolbar, so a tag or Installed shows only
 * the heroes that still have something: A-Z, with the mods that name no hero last.
 * @param {object[]} mods  each with _group set to its hero ('' for none)
 * @param {(cat: string, mod: object) => boolean} isInstalled
 */
export async function heroTiles(mods, isInstalled) {
  const byHero = new Map();
  for (const m of mods) {
    const h = m._group || '';
    if (!byHero.has(h)) byHero.set(h, []);
    byHero.get(h).push(m);
  }
  const order = [...byHero.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
  await loadHeroArt(order.filter(Boolean));
  return order.map((hero) => {
    const list = byHero.get(hero);
    const art = heroArt.get(hero);
    // No portrait (no game found, or one of the newest heroes): the first of its mods' own
    // pictures stands in, which is still that hero and still not a grey box.
    const first = list[0];
    const stand = art ? null : previewUrl(first._cat, first.preview || first.styles?.[0]?.preview);
    const standIn = Boolean(stand && !isMedia(stand));
    return {
      hero,
      count: list.length,
      installed: list.some((m) => isInstalled(m._cat, m)),
      art: art || (standIn ? resolveUrl(stand) : null),
      standIn,
    };
  });
}

/* Whole-map terrains built for an older map than the game's own (src/terrain-age.ts): the mark on
 * a catalog card and on a My mods row, and the one toast when the app switched some off.
 *
 * Such a terrain is the whole map as it was on the day it was built. Once Valve changes the map,
 * the old copy it keeps serving loses its trees, costs frames, and can get matchmaking refused
 * (issue #122). It stays installable: the mark says what it will do, and the author's next
 * build clears it. */
import { state } from './store.js';
import { esc } from '../ui/format.js';
import { toast } from '../ui/toast.js';

let asked = false;

const why = () => L`Ландшафт собран под карту старше той, что сейчас в игре. С ним могут пропасть деревья, упасть FPS и заблокироваться поиск матча, пока автор его не обновит.`;

/* Asked once, a few kilobytes per terrain archive. Until the answer comes, each whole-map card
 * holds its mark hidden, marked data-awaiting, and the answer shows or drops it in place. The
 * grid used to be drawn again instead, and a new render replays every card's entrance: the answer
 * lands a moment after the terrains open, so the whole grid came in twice. tools/sim waits for no
 * [data-awaiting] to be left before it looks at a screen. */
const listeners = new Set();

/** A card drawn by React follows the answer through here; the sweep below skips its marks. */
export function onTerrainAges(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function askCatalog() {
  if (asked) return;
  asked = true;
  const answer = (r) => {
    state.terrainAges = r || { stale: {} };
    for (const el of document.querySelectorAll('[data-awaiting="old-map"]:not([data-owned])')) {
      if (state.terrainAges.stale?.[el.dataset.file]) {
        el.hidden = false;
        el.removeAttribute('data-awaiting');
      } else {
        el.remove();
      }
    }
    for (const fn of listeners) fn();
  };
  window.api.catalog.terrainAges().then(answer).catch(() => answer(null));
}

/**
 * Whether a card carries the mark: null for anything but a whole-map terrain, 'stale' for one
 * built for an older map, and 'awaiting' until the answer arrives (asked here, once).
 */
export function terrainMark(categoryId, m) {
  if (categoryId !== 'terrains' || !m || !/\.zip$/i.test(m.file || '')) return null;
  if (!state.terrainAges) { askCatalog(); return 'awaiting'; }
  return state.terrainAges.stale?.[m.file] ? 'stale' : null;
}

/** What the mark says when pointed at. */
export const staleTerrainWhy = () => why();

/** The mark on a catalog card: '' for anything but a whole-map terrain older than the game's map. */
export function staleTerrainPillHtml(categoryId, m) {
  const mark = terrainMark(categoryId, m);
  if (!mark) return '';
  return `<span class="mtag warn" title="${esc(why())}"${mark === 'awaiting'
    ? ` data-awaiting="old-map" data-file="${esc(m.file)}" hidden` : ''}>${L`старая карта`}</span>`;
}

/** The same mark on a My mods row, which main works out when it lists the mods (staleMap). */
export function staleMapTagHtml(rec) {
  if (!rec || !rec.staleMap) return '';
  return ` <span class="lib-tag stale" title="${esc(why())}"><span class="ms">history</span>${L`старая карта`}</span>`;
}

/**
 * Once per map the game has, main switches off the whole-map terrains older than it; this says
 * which. Called at start and after a game update, which is also when the catalog's marks may
 * have changed.
 */
export async function switchOffStaleTerrains() {
  asked = false;
  state.terrainAges = null;
  try {
    const { names = [] } = await window.api.mods.switchOffStaleTerrains();
    if (names.length) {
      toast(L`Выключено: ${names.join(', ')}. Игра обновила карту, а этот ландшафт собран под прежнюю: с ним пропадают деревья и может не работать поиск матча.`, 'warn', 10000);
    }
    return names;
  } catch {
    return [];
  }
}

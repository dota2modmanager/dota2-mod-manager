/* Whole-map terrains built for an older map than the game's own (src/terrain-age.js): the mark on
 * a catalog card and on a My mods row, and the one toast when the app switched some off.
 *
 * Such a terrain is the whole map as it was on the day it was built. Once Valve changes the map,
 * the old copy it keeps serving loses its trees, costs frames, and can get matchmaking refused
 * (issue #122). It stays installable: the mark says what it will do, and the author's next
 * build clears it. */
import { state } from './store.ts';
import { toast } from '../ui/toast.js';

let asked = false;

const why = () => L`Ландшафт собран под карту старше той, что сейчас в игре. С ним могут пропасть деревья, упасть FPS и заблокироваться поиск матча, пока автор его не обновит.`;

/* Asked once, a few kilobytes per terrain archive. Until the answer comes, each whole-map card
 * holds its mark hidden, marked data-awaiting, and the answer shows or drops it in place: the
 * cards follow it through onTerrainAges (catalog/card/hooks.ts). Redrawing the grid instead would
 * replay every card's entrance, and the answer lands a moment after the terrains open, so the
 * whole grid came in twice. tools/sim waits for no [data-awaiting] to be left before it looks at
 * a screen. */
const listeners = new Set<() => void>();

/** A card follows the answer through here. */
export function onTerrainAges(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function askCatalog(): void {
  if (asked) return;
  asked = true;
  const answer = (r: { stale?: Record<string, boolean> } | null) => {
    state.terrainAges = r || { stale: {} };
    for (const fn of listeners) fn();
  };
  window.api.catalog.terrainAges().then(answer).catch(() => answer(null));
}

/**
 * Whether a card carries the mark: null for anything but a whole-map terrain, 'stale' for one
 * built for an older map, and 'awaiting' until the answer arrives (asked here, once).
 */
export function terrainMark(categoryId: string, m: { file?: string } | null | undefined): 'stale' | 'awaiting' | null {
  if (categoryId !== 'terrains' || !m || !/\.zip$/i.test(m.file || '')) return null;
  if (!state.terrainAges) { askCatalog(); return 'awaiting'; }
  return state.terrainAges.stale?.[m.file || ''] ? 'stale' : null;
}

/** What the mark says when pointed at. */
export const staleTerrainWhy = (): string => why();

/**
 * Once per map the game has, main switches off the whole-map terrains older than it; this says
 * which. Called at start and after a game update, which is also when the catalog's marks may
 * have changed.
 */
export async function switchOffStaleTerrains(): Promise<string[]> {
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

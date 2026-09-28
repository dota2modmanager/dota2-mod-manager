/* What a card follows from outside itself: the install list and the terrain answer. Both used to
 * reach into the grid and repaint it; a card drawn by React subscribes instead, and the old sweeps
 * skip anything marked data-owned="react". */
import { useSyncExternalStore } from 'react';
import { isQueued, onQueueChange } from '../../ui/queue.ts';
import { terrainMark, onTerrainAges } from '../../core/terrain-age.ts';
import type { Mod } from '../types.ts';

const subscribeQueue = (fn: () => void) => {
  const off = onQueueChange(fn);
  return () => { off(); };
};
const subscribeTerrain = (fn: () => void) => {
  const off = onTerrainAges(fn);
  return () => { off(); };
};

/** Whether the look with this key is in the install list, kept current. */
export function useQueued(key: string | null): boolean {
  return useSyncExternalStore(subscribeQueue, () => (key ? isQueued(key) : false));
}

/** The old-map mark on a whole-map terrain: 'stale', 'awaiting' the answer, or null. */
export function useTerrainMark(cat: string, mod: Mod): 'stale' | 'awaiting' | null {
  return useSyncExternalStore(subscribeTerrain, () => terrainMark(cat, mod));
}

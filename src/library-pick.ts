/* A library cosmetic as the self-contained pick a preset keeps. */
import type { LibRecord, PresetPick } from './types.ts';

/** Turn one cosmetic record into the look saved in a preset. */
export function pickOf(rec: LibRecord): PresetPick {
  const pick: PresetPick = {
    slot: String(rec.slot),
    itemId: String(rec.itemId),
    name: rec.name,
    effectId: String(rec.effectId || ''),
  };
  if (typeof rec.targetItemId === 'string' && rec.targetItemId) pick.targetItemId = rec.targetItemId;
  return pick;
}

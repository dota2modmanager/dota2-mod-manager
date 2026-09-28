/* The load order, and which rows a search leaves.
 *
 * The game mounts pakNN in numeric order, so a mod's pak number is its priority: the list is shown
 * in it, and moving a mod up or down renames its file. Fonts, cursors and cosmetic picks live
 * outside a numbered pak and have no place in it. */
import { isCosmeticRec } from '../core/records.js';
import type { LibRecord } from './types.ts';

const PAK_DIR = /^pak\d+_dir\.vpk$/i;
const langPak = (rec: LibRecord) => (rec.files || []).find((f) => f.root === 'lang' && PAK_DIR.test(f.relPath));

/** The pak a record occupies, or null for a mod outside a numbered one. */
export function pakOf(rec: LibRecord): number | null {
  const f = langPak(rec);
  return f ? Number(f.relPath.slice(3, f.relPath.indexOf('_'))) : null;
}

/* The mod's file, named exactly as it is in the mods folder: taken off the record rather than
 * rebuilt from the slot number, so it cannot drift from what is on disk, and carrying the .off
 * suffix when the mod is switched off, because that is what the folder shows. */
export function pakFileName(rec: LibRecord): string | null {
  const f = langPak(rec);
  if (!f) return null;
  return rec.enabled === false ? `${f.relPath}.off` : f.relPath;
}

/** A record's place in the load order, and whether it stands at an end of its own zone. */
export interface Place {
  index: number;
  /** the "load earlier" and "load later" moves stop at the ends of a mod's zone (src/slot-zones.js) */
  zoneFirst: boolean;
  zoneLast: boolean;
}

export function loadOrder(records: LibRecord[]): Map<string, Place> {
  const ordered = records.filter((r) => pakOf(r) != null).sort((a, b) => (pakOf(a) as number) - (pakOf(b) as number));
  return new Map(ordered.map((r, i) => [r.id, {
    index: i,
    zoneFirst: ordered[i - 1]?.zone !== r.zone,
    zoneLast: ordered[i + 1]?.zone !== r.zone,
  }]));
}

/** Whether a record answers the search, by its own name or any of its members'. */
export function matchesSearch(rec: LibRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || rec.name.toLowerCase().includes(q) || (rec.members || []).some((m) => m.name.toLowerCase().includes(q));
}

/**
 * The two lists the screen shows. Cosmetic picks are mods too, but come after everything else so
 * the list above stays what it always was; the mods run in the order the game loads them, and
 * those with no place in it close the list.
 */
export function listParts(records: LibRecord[], query: string, order: Map<string, Place>): { mods: LibRecord[]; cosmetics: LibRecord[] } {
  const shown = records.filter((r) => matchesSearch(r, query));
  const at = (r: LibRecord) => order.get(r.id)?.index ?? 1e9;
  return {
    mods: shown.filter((r) => !isCosmeticRec(r)).sort((a, b) => at(a) - at(b)),
    cosmetics: shown.filter(isCosmeticRec),
  };
}

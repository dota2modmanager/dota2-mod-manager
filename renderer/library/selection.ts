/* The ticked rows and what the bulk bar can do with them.
 *
 * A key is a record's id, or "m:<pack>:<member>" for a mod inside a pack: one selection covers
 * both, so a member can be switched off or pulled out of its pack alongside ordinary mods. */
import { isCosmeticRec, isFontRec, isPackableRec } from '../core/records.js';
import { matchesSearch } from './order.ts';
import type { LibRecord } from './types.ts';

export const memberKey = (packId: string, memberId: string): string => `m:${packId}:${memberId}`;
export const isMemberKey = (k: string): boolean => typeof k === 'string' && k.startsWith('m:');

/** A member key's pack and member. */
export function memberOf(k: string): { packId: string; memberId: string } {
  const [, packId, memberId] = k.split(':');
  return { packId, memberId };
}

/** Keys for records that are gone, or members of a pack that is: dropped from the selection. */
export function pruneSelection(sel: Set<string>, records: LibRecord[]): void {
  const valid = new Set(records.map((r) => r.id));
  for (const k of [...sel]) {
    if (!valid.has(isMemberKey(k) ? memberOf(k).packId : k)) sel.delete(k);
  }
}

/* The two lists have a "select all" each, so ticking every mod never drags a dozen cosmetic picks
 * along with it, and the other way round. A font has no switch, so there is nothing to tick. */
export const selectableMods = (records: LibRecord[], query: string): string[] =>
  records.filter((r) => !isFontRec(r) && !isCosmeticRec(r) && matchesSearch(r, query)).map((r) => r.id);
export const selectableCosmetics = (records: LibRecord[], query: string): string[] =>
  records.filter((r) => isCosmeticRec(r) && matchesSearch(r, query)).map((r) => r.id);

/** A "select all" box: ticked when every one is, a dash when some are. */
export function tristate(ids: string[], sel: Set<string>): { checked: boolean; indeterminate: boolean } {
  const n = ids.filter((id) => sel.has(id)).length;
  return { checked: ids.length > 0 && n === ids.length, indeterminate: n > 0 && n < ids.length };
}

/** What the bulk bar offers for this selection. */
export interface BulkOffer {
  count: number;
  /** standalone mods and packs that can go into one pack: it takes two */
  combinable: number;
  /** recognised catalog mods, which can be linked to their card */
  adoptable: number;
  /** mods inside packs, which can be pulled out */
  members: number;
}

export function bulkOffer(sel: Set<string>, records: LibRecord[]): BulkOffer {
  const offer: BulkOffer = { count: sel.size, combinable: 0, adoptable: 0, members: 0 };
  for (const k of sel) {
    if (isMemberKey(k)) { offer.members++; continue; }
    const r = records.find((x) => x.id === k);
    if (!r) continue;
    if (isPackableRec(r) || r.kind === 'pack') offer.combinable++;
    if (r.match) offer.adoptable++;
  }
  return offer;
}

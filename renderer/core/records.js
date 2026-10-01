import { state } from './store.js';

/* What kind of thing a library record is.
 *
 * Records are not uniform: a cursor set is loose files over Valve's own, a font pack has no
 * slot of its own, a cosmetic pick has no files at all because it is a splice into the item
 * schema. Nearly every screen has to ask, so the asking lives here rather than in whichever
 * view happened to need it first. */

// A cursor set is loose files over Valve's own in resource\cursor, not a pak: it can be
// switched on and off (the app keeps its own copy and puts the vanilla files back), but
// only one at a time, and it never goes into a combined pak.
export function isCursorRec(rec) {
  return !!rec && (rec.files || []).some((f) => f.root === 'cursor');
}

// fonts are still install-or-remove: they are a subset of panorama\fonts with no slot of
// their own, so there is nothing to switch
export function isFontRec(rec) {
  return !!rec && (rec.files || []).some((f) => f.root === 'fonts');
}

// a cosmetic pick: no files of its own (it's a splice into the item schema), so it toggles
// and deletes through the same IPC as any mod but never exports or gets bulk-selected
export function isCosmeticRec(rec) {
  return !!rec && rec.categoryId === 'cosmetic';
}

export function isPackableRec(rec) {
  return !!rec && rec.kind !== 'pack' && !['fonts', 'cursors'].includes(rec.categoryId)
    && (rec.files || []).some((f) => f.root === 'lang' && /_dir\.vpk$/i.test(f.relPath));
}

/** An item builder pick's effects by name, after its slot: " · Fire, Snow", or '' for none.
 *  One item keeps one record whatever its effects (src/item-builder.ts effectKey), so this is
 *  what tells two picks of it apart on screen. */
export function effectNames(rec) {
  if (!rec || !rec.effectId) return '';
  const known = (state.cosmeticSlots || []).find((s) => s.slot === rec.slot)?.effects || [];
  return ` · ${String(rec.effectId).split(',').filter(Boolean).map((id) => known.find((fx) => fx.id === id)?.name || id).join(', ')}`;
}

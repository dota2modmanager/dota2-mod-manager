/* Which side a pick of the game's tree or tower sets goes on, in the window "Своя карта"
 * (SidePickers.tsx): plain rules, tested in test/map-sides.test.ts. */
import type { MapOption } from '../../api/content.ts';

export type Side = 'radiant' | 'dire';
/** both sides at once, or one */
export type Which = 'both' | Side;
export interface Sides { radiant: string | null; dire: string | null }

/** What a pick does to each side: a set goes on every side it has, of those being picked for. */
export function sidesFor(set: MapOption | undefined, which: Which, was: Sides): Sides {
  const want = (side: Side) => (set && set.sides.includes(side) && set.models[side] ? set.id : null);
  if (which === 'both') return { radiant: want('radiant'), dire: want('dire') };
  return { ...was, [which]: want(which) };
}

/** Which tile reads as picked: on one side its set, on both the set both sides share. */
export function pickedOf(chosen: Sides | undefined, which: Which): string | null {
  if (!chosen) return null;
  if (which !== 'both') return chosen[which];
  return chosen.radiant === chosen.dire ? chosen.radiant : null;
}

/** For both sides, one tile per look: Valve's tower sets are an item for Radiant and another for
 * Dire under one name, and two tiles of the same name read as a mistake. The first set of each name. */
export function onePerName(sets: MapOption[], name: (o: MapOption) => string): MapOption[] {
  const seen = new Set<string>();
  return sets.filter((o) => !seen.has(name(o)) && seen.add(name(o)));
}

/** A look picked for both sides: each side takes the set of that name that has it. */
export function bothSides(sets: MapOption[], name: (o: MapOption) => string, id: string | null): Sides {
  const look = sets.find((o) => o.id === id);
  const on = (side: Side) => (look ? sets.find((o) => name(o) === name(look) && o.sides.includes(side) && o.models[side])?.id ?? null : null);
  return { radiant: on('radiant'), dire: on('dire') };
}

/** Which tile reads as picked on both sides: the look both sides wear, by name. */
export function pickedBoth(sets: MapOption[], name: (o: MapOption) => string, chosen: Sides | undefined): string | null {
  if (!chosen) return null;
  const r = sets.find((o) => o.id === chosen.radiant);
  const d = sets.find((o) => o.id === chosen.dire);
  if (!chosen.radiant && !chosen.dire) return null;
  const look = r ?? d;
  if (!look || (r && d && name(r) !== name(d))) return null;
  // a look with a set on each side reads as picked only when both are on
  const want = bothSides(sets, name, look.id);
  if (want.radiant !== chosen.radiant || want.dire !== chosen.dire) return null;
  return onePerName(sets, name).find((o) => name(o) === name(look))?.id ?? null;
}

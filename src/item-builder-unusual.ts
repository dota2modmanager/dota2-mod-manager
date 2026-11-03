/* The game's unusual and ethereal effects on any item (issue #393): Ethereal Flame, Sunfire, the
 * Champion's Auras. An owned courier's effect is a number the Game Coordinator sends; here the
 * item builder writes the effect's particle into the item's visuals as a `particle_create`, the
 * modifier the game already creates thousands of particles with, and the builder's own effects
 * use (src/item-builder-effects.ts). What each number draws is read out of items_game
 * (src/unusual-effects.ts).
 *
 * A `particle_create` gives the particle its place at the model, not the control points an effect
 * hangs on named attachments. Effects whose origin is such a point (the eye glows, Luminous Gaze)
 * have nowhere to start from, so they are not offered; effects that follow the model and put a
 * few extra points on the eyes are, and draw what follows the model.
 *
 * An effect rides in the pick's effect string as `unusual-<number>`, beside the builder's own,
 * the donor and the style (src/item-builder.ts effectKey). */
import { ITEM_EFFECTS, type ItemEffect } from './item-builder-effects.ts';
import { unusualEffects, type UnusualEffect } from './unusual-effects.ts';

/** The token of a game effect in a pick's effect string. */
export const UNUSUAL = /^unusual-(\d+)$/;

/** One game effect the picker offers: its token, and the game's own name for it to look up. */
export interface OfferedEffect { id: string; nameToken: string }

let cache: { text: string; effects: UnusualEffect[] } | null = null;
const effectsOf = (text: string): UnusualEffect[] => {
  if (cache?.text !== text) cache = { text, effects: unusualEffects(text) };
  return cache.effects;
};

// the builder's own effects already draw these systems, under names of their own
const OWN = new Set(ITEM_EFFECTS.map((e) => e.modifier.toLowerCase()));

/**
 * The effects the picker offers, by number: those the game names (dota_*.txt Attrib_Particle<n>),
 * that start at the model rather than on its eyes, and that the builder does not offer already.
 * @param named whether the game has a name for an effect's number
 */
export function offeredUnusual(text: string, named: (id: number) => boolean): OfferedEffect[] {
  return effectsOf(text)
    .filter((e) => e.system && e.attachType !== 'customorigin' && named(e.id) && !OWN.has(e.system.toLowerCase()))
    .sort((a, b) => a.id - b.id)
    .map((e) => ({ id: `unusual-${e.id}`, nameToken: `#Attrib_Particle${e.id}` }));
}

/** The effect a token names, as the builder appends one; null when the table has no such number. */
export function unusualItemEffect(text: string, token: string): ItemEffect | null {
  const n = Number(UNUSUAL.exec(token)?.[1]);
  const effect = Number.isFinite(n) ? effectsOf(text).find((e) => e.id === n && e.system) : undefined;
  return effect ? { id: token, name: token, type: 'particle_create', modifier: effect.system } : null;
}

/* A random look for a hero in the item builder: the slots left empty filled, every slot drawn
 * again, only arcanas and immortals, or one of the hero's sets. Pure: the slots, what is worn and
 * the dice are handed in, so the window and the tests draw the same way.
 *
 * Only a slot that dresses the hero's body takes part. A persona's slot would change which slots
 * the hero has, and an ability effects slot gives effects without a model: neither is a look
 * anybody means by "random". An item known to be broken in the game is never drawn. */
import type { CosmeticSet, CosmeticSlot, LookPick } from '../types.ts';

export type RandomMode = 'fill' | 'all' | 'top' | 'set';

/** The rarities "only arcanas and immortals" means, as items_game spells them. */
const TOP = new Set(['arcana', 'immortal']);

const dressable = (s: CosmeticSlot): boolean => Boolean(s.targetId) && !s.abilityFx && !s.persona && s.options.length > 0;

function draw<T>(list: T[], rand: () => number): T | null {
  return list.length ? list[Math.min(list.length - 1, Math.floor(rand() * list.length))] : null;
}

/**
 * The picks to wear, whole: what stays and what is new. Null when the mode has nothing to change,
 * so the window can say so instead of writing the same look again.
 * @param worn what the hero wears now, pick by pick (views/item-looks.ts wornPicks)
 */
export function randomPicks(slots: CosmeticSlot[], worn: LookPick[], mode: Exclude<RandomMode, 'set'>, rand: () => number = Math.random): LookPick[] | null {
  const bySlot = new Map(worn.map((p) => [p.slot, p]));
  const out: LookPick[] = [];
  let changed = false;
  for (const s of slots) {
    const now = bySlot.get(s.slot);
    const takes = dressable(s) && (mode === 'all' || mode === 'top' || !now);
    const pool = takes ? s.options.filter((o) => o.note?.status !== 'broken' && (mode !== 'top' || TOP.has(o.rarity || ''))) : [];
    // a different item than the one on, when the slot has another to give
    const fresh = pool.length > 1 && now ? pool.filter((o) => o.id !== now.itemId) : pool;
    const pick = draw(fresh, rand);
    if (pick) {
      out.push({ slot: s.slot, itemId: pick.id, name: pick.name });
      changed = true;
    } else if (now) out.push(now);
  }
  return changed ? out : null;
}

/** A set the builder can put on whole, other than the one already worn; null when there is none. */
export function randomSet(sets: CosmeticSet[], wornId: string | null, rand: () => number = Math.random): CosmeticSet | null {
  const whole = sets.filter((s) => s.pieces.length > 0 && s.pieces.every((p) => p.fits));
  const fresh = whole.length > 1 ? whole.filter((s) => s.id !== wornId) : whole;
  return draw(fresh, rand);
}

/* The game's id for a hero the catalog names, out of the item table's slots (Anti-Mage ->
 * antimage): the key of the hero's attribute and of its upright portrait, which put the catalog's
 * heroes in the game's four columns (catalog/screen/HeroGrid.tsx).
 *
 * Names are compared by their letters alone (Natures Prophet is Nature's Prophet). Centaur is the
 * one the catalog shortens. A hero newer than the slots is still found by the id the game would give
 * its folder (Kez -> kez), when the attributes know it. */
import type { CosmeticSlot, HeroAttribute } from './types.ts';

const ALIASES: Readonly<Record<string, string>> = { centaur: 'centaurwarrunner' };
const letters = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Each hero the slots name, by its letters, to its id. */
export function heroIdsByName(slots: Pick<CosmeticSlot, 'heroLabel' | 'heroIds'>[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const s of slots) {
    const id = s.heroIds?.[0];
    if (s.heroLabel && id && !ids.has(letters(s.heroLabel))) ids.set(letters(s.heroLabel), id);
  }
  return ids;
}

/** A catalog hero's game id, or '' for one neither the slots nor the attributes know. */
export function heroIdOf(name: string, ids: Map<string, string>, attrs: Record<string, HeroAttribute> = {}): string {
  const key = letters(name);
  const found = ids.get(key) || ids.get(ALIASES[key] || '');
  if (found) return found;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return Object.hasOwn(attrs, slug) ? slug : '';
}

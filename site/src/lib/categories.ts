/**
 * The catalog by category, as the pages see it.
 *
 * Built by tools/catalog.mjs beside the hero data and from the same downloads. Heroes answer
 * "what is there for Pudge"; these answer the queries that never say the word mod at all -
 * how to change the river, the menu background, the deny marker on a creep.
 */
import data from '../data/categories.json';
import type { HeroMod } from './heroes';

export interface Category {
  id: string;
  mods: Array<Omit<HeroMod, 'slots' | 'categoryId'>>;
}

/* 18+ mods are on no page of the site (src/lib/heroes.ts says why); a category of nothing else has no page. */
export const categories: Category[] = (data as { categories: Category[] }).categories
  .map((c) => ({ ...c, mods: c.mods.filter((m) => !m.adult) }))
  .filter((c) => c.mods.length);

export const categoryById = new Map(categories.map((c) => [c.id, c]));

export const totalCategoryMods = categories.reduce((n, c) => n + c.mods.length, 0);

/** A few more to offer at the foot of a category page, walking on so they vary. */
export function otherCategories(id: string, count = 6): Category[] {
  const at = categories.findIndex((c) => c.id === id);
  if (at < 0) return categories.slice(0, count);
  return Array.from({ length: count }, (_, i) => categories[(at + i + 1) % categories.length]);
}

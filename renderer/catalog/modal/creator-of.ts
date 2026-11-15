/* The creator line of a mod's window (Creator.tsx): the mod's first author, and how many mods
 * the catalog credits them with, in all and in the mod's own category. Names are matched as the
 * toolbar's author list matches them (catalog/filters.ts): "h6rd" and "H6rd" are one person. */
import { modAuthors } from '../filters.ts';
import type { Mod } from '../types.ts';

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

export function creatorOf(mod: Mod, all: Iterable<Mod>, here: Mod[]): { name: string; mods: number; here: number } | null {
  const name = modAuthors(mod)[0];
  if (!name) return null;
  const theirs = (m: Mod) => modAuthors(m).some((a) => same(a, name));
  let mods = 0;
  for (const m of all) if (theirs(m)) mods++;
  return { name, mods: Math.max(mods, 1), here: Math.max(here.filter(theirs).length, 1) };
}

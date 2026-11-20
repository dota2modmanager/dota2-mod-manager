/* One author's mods across the whole catalog, for the author's page (views/catalog/screens.ts
 * renderAuthor). The mod window already counted them ("Mods in the catalog: 14") and offered only
 * the ones in the category on screen; the rest could be found only by opening every category and
 * picking the author in each. Credited as author or modder counts, as everywhere (modAuthors). */
import { modAuthors, sameName } from './filters.ts';
import type { Mod } from './types.ts';

/** The screen key of an author's page: an "active category" the rail does not list. */
export const AUTHOR_PREFIX = 'author:';

/** Every mod credited to `name`, each tagged with its category, newest first. A mod the catalog
 *  lists in two categories is one mod, as the mod window counts it. */
export function authorMods(name: string, categories: Iterable<[string, Mod[]]>): Mod[] {
  const out: Mod[] = [];
  const seen = new Set<string>();
  for (const [cat, mods] of categories) {
    for (const m of mods) {
      const key = String(m.name || '').toLowerCase();
      if (seen.has(key) || !modAuthors(m).some((a) => sameName(a, name))) continue;
      seen.add(key);
      out.push({ ...m, _cat: cat });
    }
  }
  return out.sort((a, b) => (b.meta?.date || 0) - (a.meta?.date || 0));
}

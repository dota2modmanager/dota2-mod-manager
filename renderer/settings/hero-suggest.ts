/* Which heroes to offer for what has been typed into the hero field of the look on everybody
 * (settings/HeroPicker.tsx). A name that starts with it first ("sk": Skywrath Mage before Tusk),
 * then one with a word that does ("pro": Nature's Prophet), then any that holds it; in Chinese the
 * shown name counts as well as the English one (ui/hero-name.ts heroMatchesSearch). */
import { heroMatchesSearch, heroName } from '../ui/hero-name.ts';

export interface HeroChoice { id: string; name: string }

/** The heroes not chosen yet that match `query`, best first, at most `limit`; none for an empty query. */
export function heroSuggestions(built: HeroChoice[], chosen: string[], query: string, limit = 8, lang?: string): HeroChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = (h: HeroChoice) => {
    const names = [h.name, heroName(h.name, lang)].map((n) => n.toLowerCase());
    if (names.some((n) => n.startsWith(q))) return 0;
    if (names.some((n) => n.split(/[\s'-]+/).some((w) => w.startsWith(q)))) return 1;
    return 2;
  };
  return built
    .filter((h) => !chosen.includes(h.id) && heroMatchesSearch(h.name, q, lang))
    .map((h) => ({ h, r: rank(h) }))
    .sort((a, b) => a.r - b.r || a.h.name.localeCompare(b.h.name))
    .slice(0, limit)
    .map(({ h }) => h);
}

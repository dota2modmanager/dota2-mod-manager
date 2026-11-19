/* The tools the app has in it that a catalog search should show first, by what people type.
 *
 * Players asked on Discord for weather (rain, snow) about fourteen times by 2026-11-19, and for a
 * way to put a mod or a background of their own in the catalog five times. Both were already in
 * the app: weather in "Своя карта", the drafts in "Кабинет автора". They searched for the word,
 * found no mod by that name and decided it did not exist. A search that names the thing now puts
 * the tool's card above the mods. Nothing is drawn here (views/catalog/screens.ts asks). */

export type SearchTool = 'map' | 'background' | 'creator';

/** Beginnings of words, Russian and English, in lower case: "дожд" finds "дождь" and "дожди". */
const WORDS: Record<SearchTool, string[]> = {
  map: ['погод', 'дожд', 'снег', 'ливен', 'weather', 'rain', 'snow', 'своя карта', 'своей карт', 'own map'],
  background: ['фон', 'обои', 'background', 'wallpaper'],
  creator: [
    'свой мод', 'свои мод', 'мой мод', 'мои мод', 'своего мод', 'своих мод',
    'выложить', 'выложи', 'опубликов', 'загрузить', 'загрузи', 'закинуть', 'закину', 'добавить мод', 'добавить свой',
    'кабинет', 'черновик',
    'my mod', 'own mod', 'publish', 'upload', 'submit', 'creator',
  ],
};

/** Whether `word` begins a word in `q`: "фон" in "свой фон", not in "телефон". */
function begins(q: string, word: string): boolean {
  for (let at = q.indexOf(word); at >= 0; at = q.indexOf(word, at + 1)) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(q[at - 1])) return true;
  }
  return false;
}

/** The tools a search for `query` should lead with, in the order their cards go. */
export function toolsForSearch(query: string): SearchTool[] {
  const q = query.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  if (q.length < 3) return [];
  return (Object.keys(WORDS) as SearchTool[]).filter((tool) => WORDS[tool].some((w) => begins(q, w.replace(/ё/g, 'е'))));
}

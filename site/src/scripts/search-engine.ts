/**
 * The site's one search: what a question finds among heroes, authors and mods. The box in the
 * header (site-search.ts) and the finder on the landing (Landing.astro) both ask it and draw the
 * answer each their own way, so the two can never disagree about what exists.
 *
 * It reads /catalog/data.json once, on the first question. A hero is found by the name the game
 * writes, the Russian one and the nicknames players use ("кристалка", "сф"); an author with a page
 * by name; a mod the way the catalog's own search finds it. A name that starts with the question
 * comes before one that only contains it, and then whoever has more mods.
 */
import { loadCatalog, matcher, rank, type Catalog, type Group, type Lang } from './catalog';

export type Words = {
  heroes: string; authors: string; mods: string; empty: string; all: string;
  modsWord: [string, string, string];
  base: { mods: string; heroes: string; authors: string; catalog: string };
};

export interface Hit {
  kind: 'hero' | 'author' | 'mod';
  href: string;
  title: string;
  meta: string;
  img: string | null;
  /** a mod's group, for the colour of its dot */
  group?: Group;
}

export interface Answer {
  q: string;
  groups: Array<{ kind: Hit['kind']; label: string; hits: Hit[] }>;
  /** every mod it found, of which `groups` shows the first few */
  found: number;
  /** the catalog's own search for the question, for when there are more mods than shown */
  all: { href: string; label: string };
}

/* name: what a search ranks by and the answer is titled with; local: a Russian page's name for a
   hero under the game's one, as the hero tiles have it (Pudge, then Пудж) */
type Person = { slug: string; name: string; local?: string; hay: string; n: number; img: string | null };

export function searchEngine(lang: Lang, w: Words) {
  const nf = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US');
  const pr = new Intl.PluralRules(lang === 'ru' ? 'ru-RU' : 'en-US');
  const count = (n: number) => { const f = pr.select(n); return `${nf.format(n)} ${f === 'one' ? w.modsWord[0] : f === 'few' ? w.modsWord[1] : w.modsWord[2]}`; };

  let data: Catalog | null = null;
  let heroes: Person[] = [];
  let authors: Person[] = [];
  let loading: Promise<void> | null = null;

  const ready = () => (loading ||= loadCatalog(lang).then((c) => {
    data = c;
    // newest first, so the first picture found for a hero or an author is their newest
    const tally = (key: (m: Catalog['mods'][number]) => string | null) => {
      const out = new Map<string, { n: number; img: string | null }>();
      for (const m of c.mods) {
        const k = key(m);
        if (!k) continue;
        const e = out.get(k) ?? { n: 0, img: null };
        e.n++;
        e.img ??= m.thumb;
        out.set(k, e);
      }
      return out;
    };
    const byHero = tally((m) => m.hero);
    heroes = c.heroes
      .map((h) => ({ slug: h.slug, name: h.en, local: lang === 'ru' && h.ru.toLowerCase() !== h.en.toLowerCase() ? h.ru : undefined, hay: [h.en, h.ru, ...h.alt].join(' ').toLowerCase(), n: byHero.get(h.slug)?.n ?? 0, img: byHero.get(h.slug)?.img ?? null }))
      .filter((h) => h.n);
    const byAuthor = tally((m) => m.authorPage || null);
    const names = new Map(c.mods.filter((m) => m.authorPage).map((m) => [m.authorPage, m.author]));
    authors = [...byAuthor].map(([slug, e]) => ({ slug, name: names.get(slug)!, hay: names.get(slug)!.toLowerCase(), n: e.n, img: e.img }));
  }));

  /** The answer to a question, at most `max` of each kind; null before the data is in or for no question. */
  const answer = (question: string, max = { heroes: 3, authors: 3, mods: 6 }): Answer | null => {
    const q = question.trim();
    if (!q || !data) return null;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const has = (hay: string) => words.every((x) => hay.includes(x));
    // "пудж" starts Пудж as much as "pudge" starts Pudge
    const first = (p: Person) => ([p.name, p.local].some((x) => x?.toLowerCase().startsWith(words[0])) ? 0 : 1);
    const people = (list: Person[], n: number) => list.filter((p) => has(p.hay)).sort((a, b) => first(a) - first(b) || b.n - a.n).slice(0, n);
    const found = data.mods.filter(matcher(q)).sort((a, b) => rank(b, q) - rank(a, q));
    const groups: Answer['groups'] = [
      { kind: 'hero', label: w.heroes, hits: people(heroes, max.heroes).map((h) => ({ kind: 'hero', href: `${w.base.heroes}${h.slug}/`, title: h.name, meta: h.local ? `${h.local} · ${count(h.n)}` : count(h.n), img: h.img })) },
      { kind: 'author', label: w.authors, hits: people(authors, max.authors).map((a) => ({ kind: 'author', href: `${w.base.authors}${a.slug}/`, title: a.name, meta: count(a.n), img: a.img })) },
      {
        kind: 'mod', label: w.mods,
        hits: found.slice(0, max.mods).map((m) => ({
          kind: 'mod', href: `${w.base.mods}${m.key}/`, title: m.name, meta: m.heroName ? `${m.catName} · ${m.heroName}` : m.catName, img: m.thumb, group: m.group,
        })),
      },
    ];
    return {
      q,
      groups: groups.filter((g) => g.hits.length),
      found: found.length,
      all: { href: `${w.base.catalog}?q=${encodeURIComponent(q)}`, label: w.all.replace('{n}', nf.format(found.length)) },
    };
  };

  return { ready, answer };
}

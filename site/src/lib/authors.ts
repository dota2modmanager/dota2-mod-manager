/**
 * The people who made the catalog's mods, as the site lists them: one page each for everybody with
 * enough mods to fill one (/authors/<slug>/), and an index of them all (/authors/).
 *
 * An author is the name the catalog writes on a mod, compared without case. Where the catalog
 * gives a profile (Telegram, Steam, Discord...), the one the author's mods name most often is
 * theirs. Below MIN_MODS an author has no page, and a card's "by" still leads to their profile:
 * a page holding one or two cards says less than the card itself.
 */
import { catalog, type CatalogMod } from './catalog';
import { slugify } from './slug';
import { pathIn, type Lang } from '../i18n/ui';
import { authorsCopy } from '../i18n/authors';
import { heroCopy } from '../i18n/heroes';

export const MIN_MODS = 3;

export interface Author {
  name: string;
  slug: string;
  /** their profile, where the catalog has one */
  url: string | null;
  /** newest first, as the catalog opens */
  mods: CatalogMod[];
}

const most = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

export const authors: Author[] = (() => {
  const by = new Map<string, { names: Map<string, number>; urls: Map<string, number>; mods: CatalogMod[] }>();
  for (const m of catalog) {
    if (!m.author) continue;
    const k = m.author.trim().toLowerCase();
    let e = by.get(k);
    if (!e) by.set(k, (e = { names: new Map(), urls: new Map(), mods: [] }));
    e.names.set(m.author.trim(), (e.names.get(m.author.trim()) ?? 0) + 1);
    if (m.authorUrl) e.urls.set(m.authorUrl, (e.urls.get(m.authorUrl) ?? 0) + 1);
    e.mods.push(m);
  }
  const taken = new Set<string>();
  return [...by.values()]
    .filter((e) => e.mods.length >= MIN_MODS)
    // the most prolific first; a tie by name, so the order and the slugs do not move between builds
    .sort((a, b) => b.mods.length - a.mods.length || most(a.names)!.localeCompare(most(b.names)!))
    .map((e) => {
      const name = most(e.names)!;
      const base = slugify(name) || 'author';
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      taken.add(slug);
      return { name, slug, url: most(e.urls), mods: e.mods };
    });
})();

export const authorBySlug = new Map(authors.map((a) => [a.slug, a]));
const byName = new Map(authors.map((a) => [a.name.toLowerCase(), a]));

/** The author page a mod's "by" leads to, or null when its author has none. */
export const authorOf = (m: Pick<CatalogMod, 'author'>): Author | null => (m.author ? byName.get(m.author.trim().toLowerCase()) ?? null : null);

export const authorPath = (lang: Lang, slug: string) => pathIn(lang, `/authors/${slug}/`);

/** An author page's words in a language: the counts agree, "81 мод" never happens. */
export function authorText(lang: Lang, author: Author) {
  const c = authorsCopy[lang];
  const n = author.mods.length;
  const nf = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US');
  const f = new Intl.PluralRules(lang === 'ru' ? 'ru-RU' : 'en-US').select(n);
  const w = heroCopy[lang].modsWord;
  const word = f === 'one' ? w[0] : f === 'few' ? w[1] : w[2];
  const put = (s: string) => s.replaceAll('{author}', author.name).replaceAll('{count}', nf.format(n)).replaceAll('{word}', word);
  return {
    title: put(c.title),
    h1: put(c.h1),
    description: put(c.description),
    lead: put(c.lead),
    profile: author.url ? put(c.profile).replace('{service}', profileName(author.url)) : null,
  };
}

/** What a profile link is called: the service it is on, or its address when it is none of these. */
export function profileName(url: string): string {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  const known: Record<string, string> = {
    't.me': 'Telegram', 'telegram.me': 'Telegram', 'steamcommunity.com': 'Steam', 'github.com': 'GitHub',
    'discord.com': 'Discord', 'discord.gg': 'Discord', 'vk.com': 'VK', 'patreon.com': 'Patreon',
    'youtube.com': 'YouTube', 'boosty.to': 'Boosty', 'twitter.com': 'X', 'x.com': 'X',
  };
  return known[host] ?? host;
}

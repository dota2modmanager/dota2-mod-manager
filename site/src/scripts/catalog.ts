/**
 * The catalog in the browser: loading it, searching it, and turning a choice of mods into a
 * preset link the app opens.
 *
 * Shared by the search on the landing and the catalog's own page. The file it reads is
 * /catalog/data.json, written at build time in the compact shape src/lib/catalog.ts describes.
 *
 * A preset link is built exactly the way the app builds one (src/preset-link.ts): the JSON
 * {v, n, m} deflated raw and written in base64url. So a set put together here opens in the app
 * as if somebody had shared it from there, and the same code works on /p/ for a person who does
 * not have the app yet. test/preset.test.mjs holds the two encoders to each other.
 */
export type Lang = 'en' | 'ru';
export type Group = 'heroes' | 'world' | 'effects' | 'interface' | 'sound' | 'other';

export interface Mod {
  key: string;
  name: string;
  cat: string;
  catName: string;
  group: Group;
  hero: string | null;
  heroName: string | null;
  img: string | null;
  thumb: string | null;
  author: string;
  authorUrl: string;
  /** the author's page on this site (/authors/<slug>/); '' for an author with too few mods for one */
  authorPage: string;
  date: number;
  /** the first style, which a preset gets; '' for a mod with one look */
  style: string;
  styles: string[];
  slots: string[];
  /** Everything a search can match, lower-cased once. */
  hay: string;
}

export interface Catalog {
  mods: Mod[];
  cats: Array<{ id: string; name: string; group: Group; n: number }>;
  heroes: Array<{ slug: string; name: string }>;
  byKey: Map<string, Mod>;
}

let pending: Promise<Catalog> | null = null;

/** The catalog, fetched once per page however many times it is asked for. */
export function loadCatalog(lang: Lang): Promise<Catalog> {
  pending ||= fetch('/catalog/data.json')
    .then((r) => {
      if (!r.ok) throw new Error(`catalog: HTTP ${r.status}`);
      return r.json();
    })
    .then((raw) => decode(raw, lang));
  return pending;
}

type Raw = {
  cats: Array<[string, string, string, Group]>;
  heroes: Array<[string, string, string]>;
  mods: Array<[string, string, number, number, string, string, number, string, string[], string, string?]>;
};

function decode(raw: Raw, lang: Lang): Catalog {
  const L = lang === 'ru' ? 2 : 1;
  const cats = raw.cats.map((c) => ({ id: c[0], name: c[L], group: c[3], n: 0, en: c[1], ru: c[2] }));
  const heroes = raw.heroes.map((h) => ({ slug: h[0], name: h[L], en: h[1], ru: h[2] }));
  const mods: Mod[] = raw.mods.map((m) => {
    const cat = cats[m[2]];
    const hero = m[3] >= 0 ? heroes[m[3]] : null;
    cat.n++;
    const img = m[4] ? `/mods/${m[4]}.webp` : null;
    return {
      key: m[0], name: m[1], cat: cat.id, catName: cat.name, group: cat.group,
      hero: hero?.slug ?? null, heroName: hero?.name ?? null,
      img, thumb: img ? `/mods/t/${m[4]}.webp` : null,
      author: m[5], date: m[6], style: m[7].split('|')[0] ?? '', styles: m[7] ? m[7].split('|') : [], slots: m[8], authorUrl: m[9], authorPage: m[10] ?? '',
      // both languages' names, so "пудж" finds Pudge on the English page too
      hay: [m[1], m[7].replace(/\|/g, ' '), m[5], cat.en, cat.ru, hero?.en, hero?.ru].filter(Boolean).join(' ').toLowerCase(),
    };
  });
  return { mods, cats: cats.map(({ id, name, group, n }) => ({ id, name, group, n })), heroes, byKey: new Map(mods.map((m) => [m.key, m])) };
}

/** Every word of the query somewhere in the mod's name, hero, author or category. */
export function matcher(query: string): (m: Mod) => boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return () => true;
  return (m) => words.every((w) => m.hay.includes(w));
}

/** How well a mod matches, for the landing's few results: the name beats the hero beats the rest. */
export function rank(m: Mod, query: string): number {
  const q = query.toLowerCase().trim();
  const name = m.name.toLowerCase();
  if (!q) return 0;
  if (name.startsWith(q)) return 3;
  if (name.includes(q)) return 2;
  if (m.heroName?.toLowerCase().includes(q)) return 1;
  return 0;
}

// ---- preset links, the app's own format ----------------------------------------------------

const toBase64Url = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The code for a preset of these mods, or null where the browser cannot deflate. */
export async function presetCode(name: string, mods: Mod[]): Promise<string | null> {
  if (typeof CompressionStream !== 'function') return null;
  const payload = {
    v: 1,
    n: name.slice(0, 120),
    m: mods.map((m) => (m.style ? [m.cat, m.name, m.style] : [m.cat, m.name])),
  };
  const stream = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return toBase64Url(bytes);
}

export const appLink = (code: string) => `d2mm://preset/${code}`;
export const webLink = (code: string) => `${location.origin}/p/#${code}`;

/** "/mods/x.webp" at two sizes, for srcset. */
export const srcset = (m: Mod) => (m.img && m.thumb ? `${m.thumb} 400w, ${m.img} 854w` : '');

export const fmtDay = (lang: Lang, seconds: number) =>
  seconds ? new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(seconds * 1000)) : '';

/** Added in the last month: worth a badge. */
export const isNew = (m: Mod) => !!m.date && Date.now() / 1000 - m.date < 30 * 86400;

/** Text for the page, never HTML: everything here is built with textContent or attributes. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

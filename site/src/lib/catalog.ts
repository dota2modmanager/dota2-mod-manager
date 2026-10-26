/**
 * The whole catalog as one list, for the browser on /catalog/ and the cards everywhere else.
 *
 * The data arrives in two halves (tools/catalog.mjs): mods by category, and mods by hero. A hero's
 * mods are mostly in the heroes category, which has no list of its own, and partly in hero-items,
 * which does, so the same mod can sit in both halves. Merged here by category and name, with the
 * hero it belongs to kept on it, so the browser can filter by either and count each mod once.
 *
 * Each category belongs to one of the app's own sidebar groups (renderer/core/constants.ts,
 * RAIL_SECTIONS), and each group wears one of Dota's item rarity colours. That is the one place
 * the site uses colour to mean something: the dot on a card says what kind of mod it is.
 */
import { categories } from './categories';
import { heroes } from './heroes';
import { categoryText } from '../i18n/categories';
import { ruName } from '../i18n/hero-names';
import { slugify } from './slug';

export type Group = 'heroes' | 'world' | 'effects' | 'interface' | 'sound' | 'other';

/** The app's sidebar, in the app's order. A category nobody has placed yet goes to "other". */
export const GROUPS: Array<[Group, string[]]> = [
  ['heroes', ['heroes', 'hero-items', 'herofx', 'hero-sounds']],
  ['world', ['terrains', 'trees', 'river', 'creeps', 'towers', 'roshan', 'ancient', 'tormentor', 'wards', 'couriers', 'pedestal', 'creep-deny']],
  ['effects', ['shaders', 'ti-bp-effects', 'item-effects', 'ranged-attack', 'high-five']],
  ['interface', ['backgrounds', 'huds', 'parts', 'emblems', 'versus-screens', 'item-icons', 'ranks', 'pings', 'cursors', 'fonts']],
  ['sound', ['announcers', 'mega-kill', 'music', 'sounds']],
  ['other', ['packs', 'optimization', 'other']],
];

export const groupOf = (cat: string): Group => GROUPS.find(([, ids]) => ids.includes(cat))?.[0] ?? 'other';

export const groupNames: Record<'en' | 'ru', Record<Group, string>> = {
  en: { heroes: 'Heroes', world: 'World', effects: 'Effects', interface: 'Interface', sound: 'Sound', other: 'Other' },
  ru: { heroes: 'Герои', world: 'Мир', effects: 'Эффекты', interface: 'Интерфейс', sound: 'Звук', other: 'Прочее' },
};

export interface CatalogMod {
  /** Unique across the catalog: the mod's page is /mods/<key>/, and the quick view's #mod=<key>. */
  key: string;
  name: string;
  cat: string;
  /** The first of the mod's styles, which is the one a preset gets when it names none. */
  style: string | null;
  /** Every style the mod comes in. One card for all of them: a mod in three colours is one mod. */
  styles: string[];
  hero: string | null;
  img: string | null;
  author: string | null;
  authorUrl: string | null;
  date: number | null;
  slots: string[];
  /** Each look with its own picture, in the catalog's order: what the mod's page switches between.
      The size is the picture's own, as tools/catalog.mjs measured it: most are 854 x 480, but a
      search bar's preview came in at 397 x 1022, and a link preview that states the wrong size
      draws the picture squashed. */
  looks: Array<{ label: string | null; img: string | null; width: number; height: number }>;
}

const byKey = new Map<string, CatalogMod>();
const keyOf = (cat: string, name: string, style: string | null) => `${cat}|${name}|${style ?? ''}`;

for (const c of categories) {
  for (const m of c.mods) {
    byKey.set(keyOf(c.id, m.name, m.styleLabel), {
      key: '', name: m.name, cat: c.id, style: m.styleLabel, styles: m.styleLabel ? [m.styleLabel] : [], hero: null,
      img: m.image?.src ?? null, author: m.author, authorUrl: m.authorUrl, date: m.date, slots: [],
      looks: [{ label: m.styleLabel, img: m.image?.src ?? null, width: m.image?.width ?? 854, height: m.image?.height ?? 480 }],
    });
  }
}
for (const h of heroes) {
  for (const m of h.mods) {
    const cat = (m as { categoryId?: string }).categoryId ?? 'heroes';
    const k = keyOf(cat, m.name, m.styleLabel);
    const have = byKey.get(k);
    if (have) {
      have.hero ??= h.slug;
      if (!have.slots.length) have.slots = m.slots;
      continue;
    }
    byKey.set(k, {
      key: '', name: m.name, cat, style: m.styleLabel, styles: m.styleLabel ? [m.styleLabel] : [], hero: h.slug,
      img: m.image?.src ?? null, author: m.author, authorUrl: m.authorUrl, date: m.date, slots: m.slots,
      looks: [{ label: m.styleLabel, img: m.image?.src ?? null, width: m.image?.width ?? 854, height: m.image?.height ?? 480 }],
    });
  }
}

/* The styles of one mod arrive as separate entries; they become one card that lists them. */
const byName = new Map<string, CatalogMod>();
/* when each mod first appeared: a new look moves its date on, and must not move its address */
const since = new Map<CatalogMod, number>();
for (const m of byKey.values()) {
  const k = `${m.cat}|${m.name}`;
  const have = byName.get(k);
  if (!have) { byName.set(k, m); since.set(m, m.date ?? 0); continue; }
  for (const st of m.styles) if (!have.styles.includes(st)) have.styles.push(st);
  for (const l of m.looks) if (!have.looks.some((x) => x.label === l.label)) have.looks.push(l);
  since.set(have, Math.min(since.get(have)!, m.date ?? 0));
  have.img ??= m.img;
  have.hero ??= m.hero;
  have.date = Math.max(have.date ?? 0, m.date ?? 0) || null;
  if (!have.slots.length) have.slots = m.slots;
}

/* A mod whose looks include one the catalog leaves unnamed (a plain look and "Crimson") lists it
   as a style too, written '': without it the plain look could not be picked or sent anywhere,
   and the app looks both up the same way, as category|name| (src/preset-plan.ts). */
for (const m of byName.values()) {
  if (m.looks.length > 1 && m.looks.some((l) => !l.label)) {
    m.styles = m.looks.map((l) => l.label ?? '');
    m.style = m.styles[0];
  }
}

/** Newest first, which is the order the catalog opens in. */
export const catalog: CatalogMod[] = [...byName.values()].sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || a.name.localeCompare(b.name));
/* The key is an address people share, so it has to keep. Two mods may share a name (a hero's mod
   and a hero item of the same name), and the one that came first keeps the plain one: handed out
   newest first, a new arrival would take the old mod's address and send every link to it astray.
   "t" is the folder of the small pictures, beside the pages under /mods/. */
{
  const taken = new Set<string>(['t']);
  const byAge = [...catalog].sort((a, b) => since.get(a)! - since.get(b)! || a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  for (const m of byAge) {
    const base = slugify(m.name) || 'mod';
    let k = base;
    for (let n = 2; taken.has(k); n++) k = `${base}-${n}`;
    taken.add(k);
    m.key = k;
  }
}

/** Every category the catalog has, biggest first, with the heroes category counted too. */
export const catalogCategories = (() => {
  const count = new Map<string, number>();
  for (const m of catalog) count.set(m.cat, (count.get(m.cat) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n, group: groupOf(id) }));
})();

/** The small copy a grid shows (tools/thumbs.mjs), from the full picture's address. */
export const thumbOf = (img: string) => img.replace(/^\/mods\//, '/mods/t/');

/** The two sizes of a mod picture, for srcset. */
export const modSrcset = (img: string) => `${thumbOf(img)} 400w, ${img} 854w`;

/** Unix seconds -> "12 Oct 2026" in the page's language. */
export function dayOf(lang: 'en' | 'ru', seconds: number | null): string {
  if (!seconds) return '';
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(seconds * 1000));
}

/**
 * What the browser on /catalog/ downloads: the whole catalog in arrays rather than objects, so
 * 1,500 mods are about 150 KB before compression instead of 400. Indexes point into `cats` and
 * `heroes`, which carry the names in both languages.
 */
export function catalogPayload() {
  const catIds = catalogCategories.map((c) => c.id);
  const heroIds = heroes.map((h) => h.slug);
  const catIndex = new Map(catIds.map((id, i) => [id, i]));
  const heroIndex = new Map(heroIds.map((id, i) => [id, i]));
  return {
    v: 1,
    // the heroes category has no page and so no copy of its own; it is named here
    cats: catalogCategories.map((c) => c.id === 'heroes'
      ? [c.id, 'Heroes', 'Герои', c.group]
      : [c.id, categoryText('en', c.id).name, categoryText('ru', c.id).name, c.group]),
    // the nicknames players type ("кристалка", "сф") as a fourth field, for the site's search
    heroes: heroes.map((h) => [h.slug, h.name, ruName(h.name)?.nom ?? h.name, (ruName(h.name)?.alt ?? []).join('|')]),
    mods: catalog.map((m) => [
      m.key, m.name, catIndex.get(m.cat), m.hero ? heroIndex.get(m.hero) : -1,
      m.img ? m.img.replace(/^\/mods\/|\.webp$/g, '') : '', m.author ?? '', m.date ?? 0, m.styles.join('|'), m.slots, m.authorUrl ?? '',
    ]),
  };
}

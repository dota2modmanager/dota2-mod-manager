/**
 * One mod's page as data: its words in a language, where it belongs, and the mods to offer under it.
 *
 * Shared by the page (components/ModPage.astro), its structured data (lib/schema.ts) and the
 * sitemap, so a title cannot say one thing on the page and another to a search engine.
 */
import { catalog, type CatalogMod } from './catalog';
import { heroBySlug, type Hero } from './heroes';
import { categoryText } from '../i18n/categories';
import { modPage } from '../i18n/mod-page';
import { ruName } from '../i18n/hero-names';
import { pathIn, type Lang } from '../i18n/ui';

export const modPath = (lang: Lang, key: string) => pathIn(lang, `/mods/${key}/`);

/** The category's name as the site shows it; the heroes category has no page and is named here. */
export const kindName = (lang: Lang, cat: string) =>
  cat === 'heroes' ? (lang === 'ru' ? 'Герои' : 'Heroes') : categoryText(lang, cat).name;

export function modText(lang: Lang, mod: CatalogMod) {
  const c = modPage[lang];
  const hero: Hero | null = mod.hero ? heroBySlug.get(mod.hero) ?? null : null;
  const ru = lang === 'ru' && hero ? ruName(hero.name) : null;
  const kind = kindName(lang, mod.cat);
  const put = (s: string) =>
    s
      .replaceAll('{mod}', mod.name)
      .replaceAll('{hero}', hero?.name ?? '')
      .replaceAll('{heroAcc}', ru?.acc ?? hero?.name ?? '')
      .replaceAll('{kind}', kind)
      .replaceAll('{author}', mod.author ?? '');
  const lead = put(hero ? (mod.author ? c.leadHeroBy : c.leadHero) : (mod.author ? c.leadKindBy : c.leadKind));
  return {
    hero,
    /** the hero as the page shows them: Пудж on a Russian page */
    heroShown: hero ? (ru?.nom ?? hero.name) : null,
    kind,
    title: put(hero ? c.titleHero : c.titleKind),
    lead,
    description: `${lead} ${c.install}`,
    put,
  };
}

/**
 * What a mod's page offers under it: the same hero's other mods, or the same category's, newest
 * first, and where the whole list of them lives.
 */
export function modNeighbours(lang: Lang, mod: CatalogMod, count = 8) {
  const same = mod.hero
    ? catalog.filter((m) => m.hero === mod.hero && m.key !== mod.key)
    : catalog.filter((m) => m.cat === mod.cat && m.key !== mod.key);
  const home = mod.hero
    ? pathIn(lang, `/heroes/${mod.hero}/`)
    : mod.cat === 'heroes' ? pathIn(lang, '/heroes/') : pathIn(lang, `/catalog/${mod.cat}/`);
  // eight or four, so a row of four is never left with one card in it
  const shown = same.length >= count ? count : same.length >= 4 ? 4 : same.length;
  return { mods: same.slice(0, shown), total: same.length + 1, home };
}

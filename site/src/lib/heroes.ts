/**
 * The hero dataset, as the pages see it.
 *
 * Built by tools/heroes.mjs out of two things that had never met: hero-index.json, which the
 * fingerprint job derives from the model paths inside every archive, and the catalog, which
 * knows what each mod looks like and who made it. Committed rather than fetched at build time,
 * because the pictures are committed beside it and the two have to agree.
 */
import data from '../data/heroes.json';
import { heroCopy } from '../i18n/heroes';
import { ruName } from '../i18n/hero-names';
import type { Lang } from '../i18n/ui';

export interface HeroImage {
  src: string;
  width: number;
  height: number;
}

export interface HeroMod {
  name: string;
  styleLabel: string | null;
  /** The catalog group the mod sits in (a hero item's hero, a creep's side), part of its download
      counter's key; null in a category without groups. */
  group?: string | null;
  /** Which parts of the hero this replaces: head, weapon, arms... Empty means a recolour. */
  slots: string[];
  image: HeroImage | null;
  author: string | null;
  authorUrl: string | null;
  /** Unix seconds, from the catalog. */
  date: number | null;
}

export interface Hero {
  id: string;
  name: string;
  slug: string;
  mods: HeroMod[];
}

export const heroes: Hero[] = (data as { heroes: Hero[] }).heroes;

export const heroBySlug = new Map(heroes.map((h) => [h.slug, h]));

export const totalHeroMods = heroes.reduce((n, h) => n + h.mods.length, 0);

/**
 * One hero page's words, with the Russian nickname folded in where there is one.
 *
 * Russian queries name the hero the way the game is played, in the accusative: "моды на
 * Пуджа". So the Russian title leads with that and keeps the Latin name beside it, because
 * both get typed and the Latin one is what the catalog and the mod names use. Heroes with no
 * nickname on file read exactly as they did before.
 */
export function heroText(lang: Lang, hero: Hero) {
  const c = heroCopy[lang];
  const ru = lang === 'ru' ? ruName(hero.name) : null;

  const put = (s: string) =>
    s
      .replaceAll('{hero}', hero.name)
      .replaceAll('{ru}', ru?.nom ?? hero.name)
      .replaceAll('{ruAcc}', ru?.acc ?? hero.name);

  return {
    title: put(ru ? c.titleAka : c.title),
    h1: put(ru ? c.h1Aka : c.h1),
    description: put(ru ? c.descriptionAka : c.description),
    lead: put(c.lead),
    intro: put(c.intro),
    /** "Его же пишут как ЦМ, Кристалка." Empty when there is nothing to add. */
    aka: ru?.alt?.length ? put(c.aka).replace('{alts}', ru.alt.join(', ')) : '',
  };
}

/** A few other heroes to offer at the bottom, walking on from this one so they vary. */
export function neighbours(slug: string, count = 6): Hero[] {
  const at = heroes.findIndex((h) => h.slug === slug);
  if (at < 0) return heroes.slice(0, count);
  return Array.from({ length: count }, (_, i) => heroes[(at + i + 1) % heroes.length]);
}

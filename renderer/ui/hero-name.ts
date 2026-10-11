import chineseHeroes from '../locales/zh-CN-heroes.ts';
import { catalogName } from './catalog-name.ts';

// The catalog abbreviates these two names; keep its keys but display Valve's Chinese names.
const aliases: Readonly<Record<string, string>> = { Centaur: 'Centaur Warrunner', 'Natures Prophet': "Nature's Prophet" };
const language = (): string => typeof window === 'undefined' ? 'en' : window.I18N_LANG;

const searchNames = new Map([...Object.keys(chineseHeroes), ...Object.keys(aliases)].map((name) => [name.toLowerCase(), name]));
const searchPattern = new RegExp(`\\b(${[...searchNames.values()]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');

/** Localize hero labels without changing keys used for filters, portraits or equipment. */
export function heroName(name: string, lang: string = language()): string {
  if (lang !== 'zh-CN') return name;
  const [heroes, ...slot] = name.split(' · ');
  const translated = heroes.split(' / ').map((hero) => {
    const english = Object.hasOwn(aliases, hero) ? aliases[hero] : hero;
    return Object.hasOwn(chineseHeroes, english) ? chineseHeroes[english] : hero;
  }).join(' / ');
  return [translated, ...slot].join(' · ');
}

/** The builder's hero search accepts the displayed Chinese name and the original English name. */
export function heroMatchesSearch(name: string, query: string, lang: string = language()): boolean {
  const q = query.trim().toLowerCase();
  return name.toLowerCase().includes(q) || heroName(name, lang).toLowerCase().includes(q);
}

/** Match Chinese hero names in original mod titles without renaming them. */
export function catalogMatchesSearch(name: string, query: string, lang: string = language()): boolean {
  const q = query.trim().toLowerCase();
  if (name.toLowerCase().includes(q)) return true;
  if (lang !== 'zh-CN') return false;
  const localized = name.replace(searchPattern, (match) => heroName(searchNames.get(match.toLowerCase()) || match, lang));
  const searchable = `${name} ${localized} ${catalogName(name, lang)}`.toLowerCase();
  return q.split(/\s+/).every((term) => searchable.includes(term));
}

/** Use the owning hero for cosmetics: an axe in an item's title need not belong to Axe. */
export function cosmeticMatchesSearch(name: string, query: string, hero = '', lang: string = language()): boolean {
  const q = query.trim().toLowerCase();
  if (name.toLowerCase().includes(q)) return true;
  if (lang !== 'zh-CN') return false;
  const owner = heroName(hero, lang);
  return owner !== hero && owner.toLowerCase().includes(q);
}

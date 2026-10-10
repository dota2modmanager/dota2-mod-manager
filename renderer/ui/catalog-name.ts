/* Catalog translations are display labels. The source object, download names, styles and keys
 * stay canonical so a language change never disconnects favourites or installed mods. */
import names from '../locales/zh-CN-mod-names.json' with { type: 'json' };
import words from '../locales/zh-CN-catalog-words.json' with { type: 'json' };
import heroes from '../locales/zh-CN-heroes.ts';

const translations: Readonly<Record<string, string>> = names;
const lexicon: Readonly<Record<string, string>> = { ...heroes, ...words };
const lookup = new Map(Object.entries(lexicon).map(([key, value]) => [key.toLowerCase(), value]));
const pattern = new RegExp(`(?<![A-Za-z])(${Object.keys(lexicon).sort((a, b) => b.length - a.length)
  .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z])`, 'gi');
const language = (): string => typeof window === 'undefined' ? 'en' : window.I18N_LANG;

/** Styles, category/group labels and known words in newly added catalog titles. */
export function catalogLabel(name: string, lang = language()): string {
  if (lang !== 'zh-CN') return name;
  return name.replace(pattern, (word) => lookup.get(word.toLowerCase()) || '')
    .replace(/\bTI\s*(\d+)/gi, '国际邀请赛 $1').replace(/\bTI\b/g, '国际邀请赛')
    .replace(/\b[vV](\d+(?:\.\d+)*)/g, '第 $1 版').replace(/\s+/g, ' ').trim();
}

/** Known catalog titles have complete labels; unknown titles keep unmatched words readable. */
export function catalogName(name: string, lang = language()): string {
  if (lang !== 'zh-CN') return name;
  return Object.hasOwn(translations, name) ? translations[name] : catalogLabel(name, lang);
}

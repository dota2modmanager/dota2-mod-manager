import chineseHeroes from '../locales/zh-CN-heroes.ts';

// The catalog abbreviates these two names; keep its keys but display Valve's Chinese names.
const aliases: Readonly<Record<string, string>> = { Centaur: 'Centaur Warrunner', 'Natures Prophet': "Nature's Prophet" };

/** Localize hero labels without changing keys used for filters, portraits or equipment. */
export function heroName(name: string, lang: string = window.I18N_LANG): string {
  if (lang !== 'zh-CN') return name;
  const [heroes, ...slot] = name.split(' · ');
  const translated = heroes.split(' / ').map((hero) => {
    const english = Object.hasOwn(aliases, hero) ? aliases[hero] : hero;
    return Object.hasOwn(chineseHeroes, english) ? chineseHeroes[english] : hero;
  }).join(' / ');
  return [translated, ...slot].join(' · ');
}

/** The builder's hero search accepts the displayed Chinese name and the original English name. */
export function heroMatchesSearch(name: string, query: string, lang: string = window.I18N_LANG): boolean {
  const q = query.trim().toLowerCase();
  return name.toLowerCase().includes(q) || heroName(name, lang).toLowerCase().includes(q);
}

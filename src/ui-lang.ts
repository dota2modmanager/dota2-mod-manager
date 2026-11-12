/* The window's language on the very first start, before the person has picked one: the system's.
 * It used to be English for everybody, and most of the people who install the app read Russian
 * (plan item 21, 2026-11-12). Russian also covers the languages whose speakers usually read it
 * here; anything the app has no translation for stays English. Settings keep the choice after. */

/** The languages a system names that get the Russian window. */
const RUSSIAN = new Set(['ru', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'hy', 'az', 'ka']);

/**
 * The app's language for a system's list of preferred ones, first match wins.
 * @param locales  as Electron's app.getPreferredSystemLanguages() gives them ("ru-RU", "zh-Hans-CN")
 */
export function uiLangFor(locales: readonly string[]): 'ru' | 'zh-CN' | 'en' {
  for (const locale of locales) {
    const base = locale.toLowerCase().split(/[-_]/)[0];
    if (RUSSIAN.has(base)) return 'ru';
    if (base === 'zh') return 'zh-CN';
    if (base === 'en') return 'en';
  }
  return 'en';
}

/* A category's name from the catalog's own translations, in either of the two shapes the catalog's
 * constants.json can take: the flat map it has used so far ({ "shaders": "Shaders" }), and one
 * keyed by language ({ "en": { "shaders": "Shaders" }, "ru": { "shaders": "Шейдеры" } }), which its
 * author proposed on 2026-10-15. Reading only the flat shape would have shown a category the app
 * does not know yet by its raw id the day the catalog switched; reading both, a new category gets
 * a name in the window's language as soon as the catalog has one.
 *
 * The app's own names still come first (core/categories.ts): this is what fills in after them. */

type Translations = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * @param translations  constants.json's `translations`, whatever its shape
 * @param id            the category
 * @param lang          the window's language: 'ru', 'en' or 'zh-CN'
 * @returns the name, or null when the catalog has none for this category
 */
export function catalogTranslation(translations: unknown, id: string, lang: string): string | null {
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) return null;
  const all = translations as Translations;
  const inLanguage = (l: string): string | null => {
    const table = all[l];
    return table && typeof table === 'object' && !Array.isArray(table) ? text((table as Translations)[id]) : null;
  };
  // the window's language, then its base ('zh' for 'zh-CN'), then English, then the old flat map
  return inLanguage(lang) ?? inLanguage(lang.split('-')[0]) ?? inLanguage('en') ?? text(all[id]);
}

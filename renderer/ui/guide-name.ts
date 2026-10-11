import translations from '../locales/zh-CN-guide-text.json' with { type: 'json' };

const chinese: Readonly<Record<string, string>> = translations;

/** Exact source matching avoids applying an outdated translation to changed instructions. */
export function guideText(text: string): string {
  return window.I18N_LANG === 'zh-CN' && Object.hasOwn(chinese, text) ? chinese[text] : text;
}

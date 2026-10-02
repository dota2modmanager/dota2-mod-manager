/* What a module finds on window before it runs: the bridge preload.js exposes (typed in api/),
 * and the translation helpers i18n.js publishes (app.js imports it first). */
import type { Api } from './api/index.ts';

declare global {
  interface Window {
    api: Api;
    I18N_LANG: 'ru' | 'en';
    i18nLocale: () => 'ru' | 'en';
    /** English singular and plural, keyed by the Russian "many" form plural() is given */
    EN_PLURAL: Record<string, [string, string] | undefined>;
  }

  /** L`Текст ${x}`: the English for a Russian source string, or the Russian when there is none. */
  function L(strings: TemplateStringsArray | string, ...values: unknown[]): string;
  /** A plain lookup for labels that come from data. */
  function tr<T extends string | null | undefined>(s: T): T;
}

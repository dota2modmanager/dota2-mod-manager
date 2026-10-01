/* What a module finds on window before it runs: the bridge preload.js exposes, and the
 * translation helpers i18n.js publishes (app.js imports it first).
 *
 * The bridge is typed loosely for now: ninety-odd channels, each with its own reply, and a type
 * for each belongs next to its handler rather than guessed here. Until then a component names
 * the shape it expects where it calls one. */
export {};

declare global {
  interface Window {
    api: any;
    I18N_LANG: 'ru' | 'en';
    i18nLocale: () => 'ru' | 'en';
  }

  /** L`Текст ${x}`: the English for a Russian source string, or the Russian when there is none. */
  function L(strings: TemplateStringsArray | string, ...values: unknown[]): string;
  /** A plain lookup for labels that come from data. */
  function tr<T extends string | null | undefined>(s: T): T;
}

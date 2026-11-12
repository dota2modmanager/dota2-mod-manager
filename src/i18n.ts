// Minimal i18n for the main process (src/).
// Russian is the source language; English strings are keyed by the exact Russian text
// (with {0},{1}... placeholders for interpolated values). A missing key falls back to
// the Russian source, so the app never shows an empty/undefined string.

import EN from './i18n-en.ts';
import ZH_CN from './i18n-zh-CN.ts';

export type Lang = 'en' | 'ru' | 'zh-CN';

let currentLang: Lang = 'en';

export function setLang(lang: unknown): void {
  currentLang = lang === 'ru' || lang === 'zh-CN' ? lang : 'en';
}

export function getLang(): Lang {
  return currentLang;
}

/** The table as a lookup: any Russian string, its English or nothing. */
const EN_BY_RU: Readonly<Record<string, string | undefined>> = EN;
const ZH_BY_RU: Readonly<Record<string, string | undefined>> = ZH_CN;

function fill(tmpl: string, values: unknown[]): string {
  return tmpl.replace(/\{(\d+)\}/g, (_, i) => (values[+i] != null ? String(values[+i]) : ''));
}

// t('Мод не найден') or t('HTTP {0} — не удалось скачать {1}', status, name)
export function t(ru: string, ...values: unknown[]): string {
  const translated = currentLang === 'zh-CN' ? (ZH_BY_RU[ru] ?? EN_BY_RU[ru]) : EN_BY_RU[ru];
  const tmpl = currentLang !== 'ru' && translated != null ? translated : ru;
  return values.length ? fill(tmpl, values) : tmpl;
}


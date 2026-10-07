/* Turning values into text for the interface.
 *
 * esc() is the one that matters, and lives in renderer/ui/escape.ts so the pure readers can use it
 * without the window; it is handed on from here, where every screen already imports it. */

export { esc } from './escape.ts';

export function fmtMB(bytes: number): string { return (bytes / 1024 / 1024).toFixed(1); }

export function fmtDate(unix: number | null | undefined): string {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleDateString(window.i18nLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function plural(n: number, one: string, few: string, many: string): string {
  if (window.I18N_LANG === 'en') {
    const pair = window.EN_PLURAL[many];
    return pair ? (n === 1 ? pair[0] : pair[1]) : many;
  }
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

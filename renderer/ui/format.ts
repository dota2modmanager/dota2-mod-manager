/* Turning values into text for the interface.
 *
 * esc() is the one that matters: every template literal that interpolates a mod name, an
 * author or a file path runs through it, because catalog data is third-party content and
 * lands in innerHTML. Forgetting it is an injection, not a typo. */

const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ENTITY[c] || c);
}

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

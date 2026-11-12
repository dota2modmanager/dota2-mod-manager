/* A theme of the user's own, from a JSON file (issue #432).
 *
 * The eight heroes' palettes are Material 3 roles (styles/themes.css), and every other colour in
 * the window is read from them (styles/tokens.css). A theme file sets those same fourteen roles
 * and nothing else: the window's sizes, type and motion are the app's, and a file that could move
 * them could hide a button. The error colour stays the app's too, so trouble looks the same in
 * every theme. A picture can go behind the window, as a data URL inside the file, so one file is
 * the whole theme and can be passed around as it is.
 *
 *   { "name": "Midnight", "colors": { "primary": "#9ad0ff", ..., "outline": "#8b93a1" },
 *     "background": "data:image/webp;base64,..." }
 *
 * The file is checked before it is worn: every role a colour, no role missing, no other key, the
 * picture a PNG, JPEG or WebP under 3 MB, and the text readable on the floor (contrast as WCAG
 * counts it). A file that fails is refused with the reason, and the window keeps what it wore.
 *
 * It is kept in this window's local storage, not in settings.json: it is a look, it belongs to
 * this machine, and a broken one is thrown away with the storage rather than kept by the app. */

/** The roles a theme sets, as themes.css names them without the `--md-` in front. */
export const ROLES = ['primary', 'accent', 'on-primary', 'primary-container', 'on-primary-container', 'secondary', 'surface',
  'surface-low', 'surface-container', 'surface-high', 'surface-highest', 'on-surface', 'on-surface-variant', 'outline'] as const;
export type Role = typeof ROLES[number];

/** A theme as the file has it, once checked. */
export interface CustomTheme { name: string; colors: Record<Role, string>; background?: string }

const MAX_PICTURE = 3 * 1024 * 1024;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const PICTURE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** The pairs that have to read, and how much contrast each needs: body text 4.5, the rest 3. */
const READS: [Role, Role, number][] = [
  ['on-surface', 'surface', 4.5], ['on-surface', 'surface-container', 4.5], ['on-surface-variant', 'surface', 3],
  ['on-primary', 'primary', 4.5], ['primary', 'surface', 3], ['on-primary-container', 'primary-container', 4.5],
];

const full = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex).toLowerCase();

/** A colour's relative luminance, as WCAG 2 counts it. */
function luminance(hex: string): number {
  const v = full(hex);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How far apart two colours are for reading, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The file's text read and checked: the theme, or why it is refused (in the window's language). */
export function parseTheme(text: string): { theme: CustomTheme } | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { error: L`Это не JSON` }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: L`В файле нет темы` };
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !['name', 'colors', 'background'].includes(k));
  if (extra.length) return { error: L`Лишние поля: ${extra.join(', ')}` };
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : '';
  if (!name) return { error: L`У темы нет имени` };
  const c = o.colors as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return { error: L`У темы нет цветов` };
  const unknown = Object.keys(c).filter((k) => !(ROLES as readonly string[]).includes(k));
  if (unknown.length) return { error: L`Таких цветов тема не задаёт: ${unknown.join(', ')}` };
  const missing = ROLES.filter((r) => !(r in c));
  if (missing.length) return { error: L`Не хватает цветов: ${missing.join(', ')}` };
  const bad = ROLES.filter((r) => typeof c[r] !== 'string' || !HEX.test(c[r] as string));
  if (bad.length) return { error: L`Не цвет вида #a1b2c3: ${bad.join(', ')}` };
  const colors = Object.fromEntries(ROLES.map((r) => [r, full(c[r] as string)])) as Record<Role, string>;
  for (const [fg, bg, need] of READS) {
    const got = contrast(colors[fg], colors[bg]);
    if (got < need) return { error: L`Текст не читается: ${fg} на ${bg}, контраст ${got.toFixed(1)} из нужных ${need}` };
  }
  const theme: CustomTheme = { name, colors };
  if (o.background !== undefined) {
    if (typeof o.background !== 'string' || !PICTURE.test(o.background)) return { error: L`Фон должен быть картинкой PNG, JPEG или WebP внутри файла` };
    if (o.background.length * 0.75 > MAX_PICTURE) return { error: L`Фон больше 3 МБ` };
    theme.background = o.background;
  }
  return { theme };
}

/** The theme as a file to share: what parseTheme reads back to the same theme. */
export const themeFile = (theme: CustomTheme): string => `${JSON.stringify(theme, null, 2)}\n`;

/** One of the app's own palettes as a theme file to start from: the roles as the window wears them now. */
export function currentColors(style: CSSStyleDeclaration): Record<Role, string> {
  return Object.fromEntries(ROLES.map((r) => [r, style.getPropertyValue(`--md-${r}`).trim()])) as Record<Role, string>;
}

/** The CSS that puts the theme on the window under [data-theme='custom']. */
export function themeCss(theme: CustomTheme): string {
  const vars = ROLES.map((r) => `  --md-${r}: ${theme.colors[r]};`).join('\n');
  const bg = theme.background
    ? `\n[data-theme='custom'] body {\n  background-image: linear-gradient(color-mix(in srgb, var(--md-surface) 82%, transparent), color-mix(in srgb, var(--md-surface) 82%, transparent)), url("${theme.background}");\n  background-size: cover; background-position: center; background-attachment: fixed;\n}`
    : '';
  return `[data-theme='custom'] {\n${vars}\n}${bg}\n`;
}

const KEY = 'mm-custom-theme';

/** The theme kept on this machine, checked again: one that no longer passes is dropped. */
export function storedTheme(): CustomTheme | null {
  let text: string | null = null;
  try { text = localStorage.getItem(KEY); } catch { return null; }
  if (!text) return null;
  const r = parseTheme(text);
  return 'theme' in r ? r.theme : null;
}

/** Keep the theme on this machine, or forget it (null). */
export function storeTheme(theme: CustomTheme | null): void {
  try {
    if (theme) localStorage.setItem(KEY, themeFile(theme));
    else localStorage.removeItem(KEY);
  } catch { /* a full or blocked storage keeps the theme for this session only */ }
}

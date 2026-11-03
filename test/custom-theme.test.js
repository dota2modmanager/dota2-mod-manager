/* A theme of the user's own from a JSON file (renderer/ui/custom-theme.ts, issue #432): the
 * fourteen roles and nothing else, each a colour, the text readable on the floor, the picture a
 * small image inside the file; and the file the app saves reads back to the same theme. */
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.window = { I18N_LANG: 'ru' };
globalThis.L = (strings, ...values) => (typeof strings === 'string'
  ? strings
  : strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), ''));

const load = () => import('../renderer/ui/custom-theme.ts');

// Ursa's palette from styles/themes.css: a theme that passes
const URSA = {
  primary: '#d0bcff', accent: '#b190ff', 'on-primary': '#220a32', 'primary-container': '#4f378b', 'on-primary-container': '#f4e7ff',
  secondary: '#ccc2dc', surface: '#141218', 'surface-low': '#1d1b20', 'surface-container': '#211f26', 'surface-high': '#2b2930',
  'surface-highest': '#36343b', 'on-surface': '#e6e0e9', 'on-surface-variant': '#cac4d0', outline: '#938f99',
};
const file = (o) => JSON.stringify(o);

test("the app's own palette passes, and the saved file reads back to the same theme", async () => {
  const { parseTheme, themeFile } = await load();
  const r = parseTheme(file({ name: 'Ursa', colors: URSA }));
  assert.ok('theme' in r, JSON.stringify(r));
  assert.deepEqual(parseTheme(themeFile(r.theme)), r);
  const short = parseTheme(file({ name: 'Short', colors: { ...URSA, surface: '#111' } }));
  assert.equal(short.theme.colors.surface, '#111111', 'a three-digit colour, written out');
});

test("every palette the app ships passes the same checks, so the bar is no higher than the app's own", async () => {
  const { parseTheme, ROLES } = await load();
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../renderer/styles/themes.css'), 'utf8');
  let n = 0;
  for (const m of css.matchAll(/\[data-theme='([a-z]+)'\]\s*\{([^}]*)\}/g)) {
    const colors = {};
    for (const v of m[2].matchAll(/--md-([a-z-]+):\s*(#[0-9a-f]+)/gi)) if (ROLES.includes(v[1])) colors[v[1]] = v[2];
    if (!Object.keys(colors).length) continue; // the rainbow wears the others in turn
    assert.equal(parseTheme(JSON.stringify({ name: m[1], colors })).error, undefined, m[1]);
    n++;
  }
  assert.ok(n >= 8, `${n} palettes`);
});

test('a file that sets anything but the roles, or misses one, or is not a colour, is refused', async () => {
  const { parseTheme } = await load();
  assert.match(parseTheme('{').error, /JSON/);
  assert.match(parseTheme(file({ colors: URSA })).error, /имени/);
  assert.match(parseTheme(file({ name: 'x', colors: URSA, css: 'body{}' })).error, /css/);
  assert.match(parseTheme(file({ name: 'x', colors: { ...URSA, 'radius': '0' } })).error, /radius/);
  const { outline: _outline, ...missing } = URSA;
  assert.match(parseTheme(file({ name: 'x', colors: missing })).error, /outline/);
  assert.match(parseTheme(file({ name: 'x', colors: { ...URSA, primary: 'red; background: url(x)' } })).error, /primary/);
});

test('text that would not read on the floor is refused, with the pair and the numbers', async () => {
  const { parseTheme, contrast } = await load();
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  const r = parseTheme(file({ name: 'Grey', colors: { ...URSA, 'on-surface': '#2a2830' } }));
  assert.match(r.error, /on-surface на surface/);
});

test('the picture is a PNG, JPEG or WebP inside the file, under 3 MB', async () => {
  const { parseTheme, themeCss } = await load();
  const ok = parseTheme(file({ name: 'Pic', colors: URSA, background: 'data:image/png;base64,iVBORw0KGgo=' }));
  assert.ok(ok.theme.background);
  assert.match(themeCss(ok.theme), /url\("data:image\/png/);
  assert.match(parseTheme(file({ name: 'x', colors: URSA, background: 'https://example.com/a.png' })).error, /картинкой/);
  assert.match(parseTheme(file({ name: 'x', colors: URSA, background: 'data:image/svg+xml;base64,PHN2Zz4=' })).error, /картинкой/);
  const big = `data:image/png;base64,${'A'.repeat(4.1 * 1024 * 1024)}`;
  assert.match(parseTheme(file({ name: 'x', colors: URSA, background: big })).error, /3 МБ/);
});

test('the CSS sets the roles under the custom theme and nothing else', async () => {
  const { parseTheme, themeCss } = await load();
  const css = themeCss(parseTheme(file({ name: 'Ursa', colors: URSA })).theme);
  assert.match(css, /^\[data-theme='custom'\] \{/);
  assert.equal((css.match(/--md-/g) || []).length, 14);
  assert.doesNotMatch(css, /background-image/);
});

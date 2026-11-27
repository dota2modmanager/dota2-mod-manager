/* The themes the window can wear (renderer/ui/theme-list.ts): the round the mascot goes and the
 * cards in Settings show, and every one of them backed by a palette in styles/themes.css. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

globalThis.window = { I18N_LANG: 'ru' };
globalThis.L = (strings, ...values) => (typeof strings === 'string'
  ? strings
  : strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), ''));

const load = () => import('../renderer/ui/theme-list.ts');

test("Settings lists the eight heroes, then the app's own six, then only the optional ones there are", async () => {
  const { themeChoices, HEROES, EXTRA } = await load();
  assert.deepEqual(themeChoices({ custom: false, secret: false, blood: false }), [...HEROES, ...EXTRA]);
  assert.deepEqual(themeChoices({ custom: true, secret: true, blood: true }).slice(-3), ['custom', 'secret', 'blood']);
  assert.deepEqual(themeChoices({ custom: false, secret: true, blood: false }).slice(-1), ['secret']);
});

test("the mascot goes round only the themes it always had: the app's own are Settings' alone", async () => {
  const { themeRound, HEROES, EXTRA } = await load();
  assert.deepEqual(themeRound({ custom: false, secret: false, blood: false }), [...HEROES]);
  assert.deepEqual(themeRound({ custom: true, secret: true, blood: true }), [...HEROES, 'custom', 'secret', 'blood']);
  for (const id of EXTRA) assert.ok(!themeRound({ custom: true, secret: true, blood: true }).includes(id), id);
});

test("every theme there is has its palette in themes.css, and every one of the app's own a mascot", async () => {
  const { themeChoices, EXTRA, HEROES, MASCOT } = await load();
  const css = fs.readFileSync(path.join(__dirname, '../renderer/styles/themes.css'), 'utf8').replace(/\r\n/g, '\n');
  for (const id of themeChoices({ custom: false, secret: false, blood: true })) {
    assert.ok(css.includes(`[data-theme='${id}'] {\n  --md-primary:`), id);
  }
  for (const id of EXTRA) assert.ok(HEROES.includes(MASCOT[id]), `${id} wears a hero's mascot`);
});

test('every theme has a name to show', async () => {
  const { themeChoices, themeName } = await load();
  for (const id of themeChoices({ custom: true, secret: true, blood: true })) assert.notEqual(themeName(id), id, id);
});

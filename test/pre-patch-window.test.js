/* The window the "pre-patch" pill opens (renderer/views/library/pre-patch.ts, issue #416): which
 * of a mod's files a Dota update changed or took away, and the one step that fits the mod. */
const test = require('node:test');
const assert = require('node:assert/strict');

// i18n.js puts these on window before any module runs; the tests read the Russian source
globalThis.window = { I18N_LANG: 'ru' };
globalThis.tr = (s) => s;
globalThis.L = (strings, ...values) => (typeof strings === 'string'
  ? strings
  : strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), ''));

const load = () => import('../renderer/views/library/pre-patch.ts');
const rec = (extra) => ({
  id: 'hud', name: 'Old HUD', enabled: true, categoryId: 'hud', files: [],
  prePatch: { since: '6946', changed: 2, removed: 1, changedPaths: ['panorama/a.vxml_c', 'panorama/<b>.vxml_c'], removedPaths: ['gone.vtex_c'] },
  ...extra,
});

test('the window lists the changed and the removed files, escaped', async () => {
  const { prePatchHtml } = await load();
  const html = prePatchHtml(rec());
  assert.match(html, /Изменены: 2/);
  assert.match(html, /Убраны из игры: 1/);
  assert.match(html, /panorama\/a\.vxml_c/);
  assert.match(html, /&lt;b&gt;/, 'a path is text, never markup');
  assert.match(html, /Dota 6946/);
});

test('a mod with a newer file is offered the update; any other the switch; every one the all-clear', async () => {
  const { prePatchHtml } = await load();
  const newer = prePatchHtml(rec({ updateAvailable: true }));
  assert.match(newer, /data-c="update"/);
  assert.doesNotMatch(newer, /data-c="off"/);
  const plain = prePatchHtml(rec());
  assert.match(plain, /data-c="off"/);
  assert.doesNotMatch(plain, /data-c="update"/);
  assert.doesNotMatch(prePatchHtml(rec({ enabled: false })), /data-c="off"/, 'a mod already off is not offered the switch');
  for (const html of [newer, plain]) assert.match(html, /data-c="fine"/);
});

test('a long list says how many more there are, and an empty kind is left out', async () => {
  const { prePatchHtml } = await load();
  const many = Array.from({ length: 100 }, (_, i) => `f${i}.vtex_c`);
  const html = prePatchHtml(rec({ prePatch: { since: null, changed: 250, removed: 0, changedPaths: many, removedPaths: [] } }));
  assert.match(html, /и ещё 220/);
  assert.doesNotMatch(html, /Убраны из игры/);
  assert.match(html, /Dota обновила/, 'no build number, no stray space');
});

/* A category's name from the catalog's translations (renderer/core/catalog-translation.ts), in the
 * flat shape constants.json has today and the one keyed by language its author proposed. Either
 * way the window must find a name, and nothing the catalog puts there may throw. */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/core/catalog-translation.ts');

test('the flat map the catalog has today still names a category', async () => {
  const { catalogTranslation } = await load();
  const flat = { shaders: 'Shaders', 'shaders-desc': 'Replaces the fog of war effect' };
  assert.equal(catalogTranslation(flat, 'shaders', 'ru'), 'Shaders');
  assert.equal(catalogTranslation(flat, 'shaders', 'en'), 'Shaders');
  assert.equal(catalogTranslation(flat, 'river', 'en'), null);
});

test('a map keyed by language names it in the window\'s language, then English', async () => {
  const { catalogTranslation } = await load();
  const byLang = { en: { shaders: 'Shaders', river: 'River' }, ru: { shaders: 'Шейдеры' }, zh: { shaders: '着色器' } };
  assert.equal(catalogTranslation(byLang, 'shaders', 'ru'), 'Шейдеры');
  assert.equal(catalogTranslation(byLang, 'shaders', 'en'), 'Shaders');
  assert.equal(catalogTranslation(byLang, 'shaders', 'zh-CN'), '着色器', "'zh' answers for 'zh-CN'");
  assert.equal(catalogTranslation(byLang, 'river', 'ru'), 'River', 'a language without the name falls back to English');
  assert.equal(catalogTranslation(byLang, 'trees', 'ru'), null);
});

test('both shapes at once: the language table wins, the flat key fills in', async () => {
  const { catalogTranslation } = await load();
  const mixed = { ru: { shaders: 'Шейдеры' }, shaders: 'Shaders', trees: 'Trees' };
  assert.equal(catalogTranslation(mixed, 'shaders', 'ru'), 'Шейдеры');
  assert.equal(catalogTranslation(mixed, 'trees', 'ru'), 'Trees');
});

test('nothing the catalog puts there throws, and nothing that is not a name is shown', async () => {
  const { catalogTranslation } = await load();
  for (const odd of [undefined, null, 'translations', 42, [], [['shaders', 'x']]]) {
    assert.equal(catalogTranslation(odd, 'shaders', 'ru'), null, JSON.stringify(odd));
  }
  assert.equal(catalogTranslation({ ru: { shaders: '' }, shaders: '  ' }, 'shaders', 'ru'), null, 'an empty name is no name');
  assert.equal(catalogTranslation({ ru: { shaders: { name: 'x' } } }, 'shaders', 'ru'), null, 'an object is not a name');
  assert.equal(catalogTranslation({ ru: 'Шейдеры' }, 'shaders', 'ru'), null, 'a language whose value is not a table');
  // a category whose id is a language code is still looked up as a category in the flat shape
  assert.equal(catalogTranslation({ en: 'English mods' }, 'en', 'ru'), 'English mods');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setLang, getLang, t } = require('../src/i18n.ts');
const nativeChinese = require('../src/i18n-zh-CN.ts').default;

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const tokens = (text) => (text.match(/\{\d+\}/g) || []).sort();

function renderer(lang, storageThrows = false) {
  const context = vm.createContext({
    window: {}, console,
    localStorage: { getItem: () => { if (storageThrows) throw new Error('unavailable'); return lang; } },
  });
  for (const name of ['catalog', 'library', 'app']) {
    vm.runInContext(read(`renderer/locales/zh-CN-${name}.js`), context);
  }
  vm.runInContext(read('renderer/i18n.js') + '\nthis.english = EN;', context);
  return context;
}

function complete(english, chinese) {
  assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort(), 'same source keys');
  for (const [key, value] of Object.entries(chinese)) {
    assert.ok(value.length, `empty translation: ${key}`);
    assert.doesNotMatch(value, /[А-Яа-яЁё]/, `Cyrillic in translation: ${key}`);
    assert.deepEqual(tokens(value), tokens(key), `placeholders: ${key}`);
  }
}

test('Simplified Chinese covers every renderer and native key, keeping every placeholder', () => {
  const context = renderer('zh-CN');
  complete(context.english, context.window.ZH_CN);
  const nativeSource = read('src/i18n.ts').match(/const EN = (\{[\s\S]*?\}) satisfies Record<string, string>;/);
  assert.ok(nativeSource, 'native dictionary found');
  complete(vm.runInNewContext(`(${nativeSource[1]})`), nativeChinese);
  assert.deepEqual(Object.keys(context.window.ZH_CN_PLURAL).sort(), Object.keys(context.window.EN_PLURAL).sort());
});

test('Chinese is restored before the renderer draws, with a Chinese date and number locale', () => {
  const context = renderer('zh-CN');
  assert.equal(context.window.I18N_LANG, 'zh-CN');
  assert.equal(context.window.i18nLocale(), 'zh-CN');
  assert.equal(context.window.tr('Настройки'), '设置');
  assert.equal(vm.runInContext('L`Надето: ${"Official item"}`', context), '已装备：Official item');
  assert.equal(context.window.tr(null), null);
  assert.equal(context.window.tr('an external item name'), 'an external item name');
});

test('existing English, Russian and unknown-language defaults keep their previous behavior', () => {
  for (const lang of ['en', 'ru', 'de', null]) {
    const context = renderer(lang);
    assert.equal(context.window.I18N_LANG, lang === 'ru' ? 'ru' : 'en');
    assert.equal(context.window.tr('Настройки'), lang === 'ru' ? 'Настройки' : 'Settings');
  }
  assert.equal(renderer('zh-CN', true).window.I18N_LANG, 'en');
});

test('native dialogs and errors follow Chinese while preserving interpolated file names', () => {
  const before = getLang();
  try {
    setLang('zh-CN');
    assert.equal(getLang(), 'zh-CN');
    assert.equal(t('Мод не найден'), '未找到模组');
    assert.equal(t('Не найден {0}', 'Official.vpk'), '未找到 Official.vpk');
    assert.equal(t('untranslated {0}', 'name'), 'untranslated name');
    setLang('ru');
    assert.equal(t('Мод не найден'), 'Мод не найден');
    setLang('en');
    assert.equal(t('Мод не найден'), 'Mod not found');
    setLang('unknown');
    assert.equal(getLang(), 'en');
  } finally { setLang(before); }
});

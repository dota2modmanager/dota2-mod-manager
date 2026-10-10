const test = require('node:test');
const assert = require('node:assert/strict');
const heroes = require('../renderer/locales/zh-CN-heroes.ts').default;
const { heroName, heroMatchesSearch } = require('../renderer/ui/hero-name.ts');

test('Chinese hero labels use official names, including newer heroes and irregular English names', () => {
  assert.equal(Object.keys(heroes).length, 127);
  for (const [english, chinese] of [
    ['Anti-Mage', '敌法师'], ['Juggernaut', '主宰'], ['Bane', '祸乱之源'],
    ["Nature's Prophet", '自然先知'], ['Io', '艾欧'], ['Terrorblade', '恐怖利刃'],
    ['Primal Beast', '獸'], ['Muerta', '琼英碧灵'], ['Ringmaster', '百戏大王'],
    ['Kez', '凯'], ['Largo', '朗戈'], ['Centaur', '半人马战行者'], ['Natures Prophet', '自然先知'],
  ]) assert.equal(heroName(english, 'zh-CN'), chinese);
});

test('hero display localization preserves shared slots, original keys and unknown custom names', () => {
  const label = 'Axe / Juggernaut · 武器';
  assert.equal(heroName(label, 'zh-CN'), '斧王 / 主宰 · 武器');
  for (const lang of ['en', 'ru', 'unknown']) assert.equal(heroName(label, lang), label);
  for (const name of ['Centaur', 'Natures Prophet']) assert.equal(heroName(name, 'en'), name);
  for (const name of ['', 'Axe Kratos', 'Custom hero', '__proto__', 'constructor']) {
    assert.equal(heroName(name, 'zh-CN'), name);
  }
  const before = globalThis.window;
  try {
    globalThis.window = { I18N_LANG: 'zh-CN' };
    assert.equal(heroName('Shadow Fiend'), '影魔');
    assert.equal(heroMatchesSearch('Shadow Fiend', '影魔'), true);
    globalThis.window.I18N_LANG = 'en';
    assert.equal(heroName('Shadow Fiend'), 'Shadow Fiend');
  } finally { globalThis.window = before; }
});

test('the hero picker search accepts Chinese or English while other languages keep English search', () => {
  assert.equal(heroMatchesSearch('Terrorblade', ' 恐怖 ', 'zh-CN'), true);
  assert.equal(heroMatchesSearch('Terrorblade', ' TERROR ', 'zh-CN'), true);
  assert.equal(heroMatchesSearch('Axe / Juggernaut', '主宰', 'zh-CN'), true);
  assert.equal(heroMatchesSearch('Axe', '', 'zh-CN'), true);
  assert.equal(heroMatchesSearch('Axe', '斧王', 'en'), false);
  assert.equal(heroMatchesSearch('Axe', '斧王', 'ru'), false);
  assert.equal(heroMatchesSearch('Axe', '斧王', 'unknown'), false);
  assert.equal(heroMatchesSearch('Axe', '主宰', 'zh-CN'), false);
  assert.equal(heroMatchesSearch('Custom hero', 'custom', 'zh-CN'), true);
});

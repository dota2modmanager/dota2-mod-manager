/// <reference lib="dom" />
/// <reference path="../renderer/globals.d.ts" />
import test from 'node:test';
import assert from 'node:assert/strict';
import heroes from '../renderer/locales/zh-CN-heroes.ts';
import { heroName, heroMatchesSearch, catalogMatchesSearch, cosmeticMatchesSearch } from '../renderer/ui/hero-name.ts';

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
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'window', { value: { I18N_LANG: 'zh-CN' }, configurable: true });
    assert.equal(heroName('Shadow Fiend'), '影魔');
    assert.equal(heroMatchesSearch('Shadow Fiend', '影魔'), true);
    assert.equal(catalogMatchesSearch('Shadow Fiend Arcana', '影魔'), true);
    assert.equal(cosmeticMatchesSearch('Custom weapon', '影魔', 'Shadow Fiend'), true);
    globalThis.window.I18N_LANG = 'en';
    assert.equal(heroName('Shadow Fiend'), 'Shadow Fiend');
  } finally {
    if (before) Object.defineProperty(globalThis, 'window', before);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('global search matches Chinese hero names in original mod titles, including aliases and shared mods', () => {
  for (const [name, query] of [
    ['Axe Kratos', ' 斧王 '], ['Axe Kratos', '斧王 kratos'], ['axe Kratos', '斧王'],
    ['Axe / Juggernaut pack', '主宰'], ['Centaur skin', '半人马'],
    ['Natures Prophet skin', '自然先知'], ["Nature's Prophet skin", '自然先知'],
    ['Keeper of the Light skin', '光之守卫'], ['Anti-Mage skin', '敌法师'],
  ]) assert.equal(catalogMatchesSearch(name, query, 'zh-CN'), true, `${name}: ${query}`);
  assert.equal(catalogMatchesSearch('Axe Kratos', '主宰', 'zh-CN'), false);
  assert.equal(catalogMatchesSearch('Pickaxe', '斧王', 'zh-CN'), false);
  assert.equal(catalogMatchesSearch('DIO skin', '艾欧', 'zh-CN'), false);
});

test('global cosmetic search uses the Chinese owning hero while preserving item names and English/Russian matching', () => {
  assert.equal(cosmeticMatchesSearch('Blade of the Last Emperor', '主宰', 'Juggernaut', 'zh-CN'), true);
  assert.equal(cosmeticMatchesSearch('Shared weapon', '斧王', 'Axe / Juggernaut · 武器', 'zh-CN'), true);
  assert.equal(cosmeticMatchesSearch('Custom weapon', 'Custom hero', 'Custom hero', 'zh-CN'), false);
  assert.equal(cosmeticMatchesSearch("Drowned Horseman's Axe and Buckler", '斧王', 'Abaddon', 'zh-CN'), false);
  assert.equal(cosmeticMatchesSearch('Axe loading screen', '斧王', undefined, 'zh-CN'), false);
  for (const lang of ['zh-CN', 'en', 'ru', 'unknown']) {
    assert.equal(catalogMatchesSearch('Axe Kratos', ' AXE ', lang), true);
    assert.equal(cosmeticMatchesSearch('Blade of the Last Emperor', 'last emperor', 'Juggernaut', lang), true);
    assert.equal(catalogMatchesSearch('Custom 中文 pack', '中文', lang), true);
    assert.equal(catalogMatchesSearch('Axe Kratos', '', lang), true);
  }
  for (const lang of ['en', 'ru', 'unknown']) {
    assert.equal(catalogMatchesSearch('Axe Kratos', '斧王', lang), false);
    assert.equal(cosmeticMatchesSearch('Blade of the Last Emperor', '主宰', 'Juggernaut', lang), false);
    assert.equal(cosmeticMatchesSearch('Blade of the Last Emperor', 'Juggernaut', 'Juggernaut', lang), false);
  }
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

/// <reference lib="dom" />
/// <reference path="../renderer/globals.d.ts" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogName, catalogLabel } from '../renderer/ui/catalog-name.ts';

test('catalog aliases and official phrases precede individual words without consuming longer names', () => {
  const labels = {
    'Cj Anti Mage': 'Cj 敌法师',
    'Anti Mage Taunt Tt': '敌法师 嘲讽 Tt',
    'Kotl Obeisance Of The Keeper': '光之守卫 守卫之尊',
    'Grimstroke The Chained Scribe': '天涯墨客 链缚文人',
    'Iron Branch': '铁树枝干',
    'Mecha Boots Of Travel Mk Ill': 'Mecha 远行鞋 Mk Ill',
    'Baby Roshan Diretide': '肉山宝宝 夜魇暗潮',
    'Road Cone Trees': '路锥 树木',
    'Dark Grey Minimap': '深灰色 小地图',
    'Light Blue Radius Texture': '浅蓝色 范围贴图',
    'Black Diretide Ranged Attack': '黑色 夜魇暗潮 远程攻击',
  };
  for (const [source, expected] of Object.entries(labels)) {
    assert.equal(catalogName(source, 'zh-CN'), expected, source);
    assert.equal(catalogLabel(source, 'zh-CN'), expected, source);
    for (const lang of ['en', 'ru']) assert.equal(catalogName(source, lang), source);
  }
  assert.equal(catalogLabel('Anti-Mage', 'zh-CN'), '敌法师');
  assert.equal(catalogLabel('Mage', 'zh-CN'), '法师');
  assert.equal(catalogLabel('Kotlet', 'zh-CN'), 'Kotlet');
  assert.equal(catalogLabel('Iron Branches', 'zh-CN'), '铁 Branches');
  assert.equal(catalogName('GG Iron Branch', 'zh-CN'), '精彩对局 铁树枝干');
  assert.equal(catalogName('Christmas Iron Branch', 'zh-CN'), '圣诞 铁树枝干');
});

test('official tower labels retain their faction and match Valve item titles', () => {
  // These are item-name tokens, not similarly worded minigame labels or descriptions.
  const labels = {
    'Declaration of the Divine Light': '圣光宣言天辉防御塔',
    'Declaration of the Divine Shadow': '圣影宣言夜魇防御塔',
    'Grasp of the Elder Gods Radiant': '古神之势 - 天辉防御塔',
    'Grasp of the Elder Gods Dire': '古神之势 - 夜魇防御塔',
    'Guardians of the Lost Path Radiant': '失落之径的卫士 - 天辉防御塔',
    'Guardians of the Lost Path Dire': '失落之径的卫士 - 夜魇防御塔',
    'Stoneclaw Scavengers Radiant': '石爪清道夫天辉防御塔',
    'Stoneclaw Scavengers Dire': '石爪清道夫夜魇防御塔',
  };
  for (const [source, expected] of Object.entries(labels)) {
    assert.equal(catalogName(source, 'zh-CN'), expected, source);
    for (const lang of ['en', 'ru']) assert.equal(catalogName(source, lang), source);
  }
});

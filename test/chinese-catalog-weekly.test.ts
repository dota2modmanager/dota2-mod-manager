/// <reference lib="dom" />
/// <reference path="../renderer/globals.d.ts" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogName, catalogLabel } from '../renderer/ui/catalog-name.ts';
import { guideText } from '../renderer/ui/guide-name.ts';

test('catalog phrases keep color, interface and weapon meanings ahead of single words', () => {
  const titles = {
    'Light Blue Top Bar': '浅蓝色 顶部栏',
    'High Five Cat Paw': '击掌 猫爪',
    'Shadow Shaman Desert Eagle': '暗影萨满 沙漠之鹰',
    'Keeper Of The Light Invisible Horse': '光之守卫 隐形坐骑',
    'Netgraph Purple': '网络状态图 紫色',
    'Netgraph Black': '网络状态图 黑色',
    'Kda Red': '击杀/死亡/助攻 红色',
    'Vs Creen': '对阵画面',
    'Vs Creen Lycoris Colors V2': '对阵画面 Lycoris Colors 第 2 版',
    '12C3M8Jydwfodsjlo Mega Kill': '12C3M8Jydwfodsjlo 连杀播报',
    'Unseen Main Menu': 'Unseen 主菜单',
    'Style black': '黑色款式',
    'Style white': '白色款式',
    'Game Mode': '游戏模式',
    'Misc': '其他',
    'Full remove': '完全移除',
    'Sound remove': '移除音效',
  };
  for (const [source, expected] of Object.entries(titles)) {
    assert.equal(catalogName(source, 'zh-CN'), expected, source);
    assert.equal(catalogLabel(source, 'zh-CN'), expected, source);
    for (const lang of ['en', 'ru']) assert.equal(catalogName(source, lang), source);
  }
  assert.equal(catalogLabel('Keeper Of The Light', 'zh-CN'), '光之守卫');
  assert.equal(catalogLabel('Black King Bar', 'zh-CN'), '黑皇杖');
  assert.equal(catalogLabel('Monkey King Bar', 'zh-CN'), '金箍棒');
  assert.equal(catalogLabel('Light Blueberry', 'zh-CN'), '光明 Blueberry');
});

test('complete catalog labels repair removal instructions and existing menu titles', () => {
  const titles = {
    'No Unnecessary Models': '移除多余模型',
    'No Unnecessary Map Effects': '移除多余地图特效',
    'Hero Auto Pick': '自动选择英雄',
    'Question Marks': '问号',
    'Crystal Interface': '水晶界面',
    'Japanese Background': '日式背景',
    'Girl Resting Under Tree': '树下休憩的少女',
    'Stylish Cat': '时髦猫咪',
    'Main Menu 7.00 Style': '7.00 风格主菜单',
    'Sora Main Menu': '空 主菜单',
    'Stairs Guy Main Menu': '阶梯 男子 主菜单',
  };
  for (const [source, expected] of Object.entries(titles)) {
    assert.equal(catalogName(source, 'zh-CN'), expected, source);
    for (const lang of ['en', 'ru']) assert.equal(catalogName(source, lang), source);
  }
  // Japanese titles also contain "No"; removal wording belongs to the two exact titles.
  assert.equal(catalogName('Majo No Tabitabi', 'zh-CN'), 'Majo 之 Tabitabi');
  assert.equal(catalogName('Unknown Auto Pick', 'zh-CN'), 'Unknown Auto Pick');
});

test('auto-pick guide keeps uncertainty and repeated-command warning, with exact-source fallback', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { I18N_LANG: 'zh-CN' } });
  const source = 'This is a standard VPK that modifies the Play menu, but its safety is unconfirmed. During the hero pick phase it automatically and repeatedly sends hero selection commands, which Valve may treat as automation, so use it at your own risk.';
  try {
    const chinese = guideText(source);
    assert.match(chinese, /安全性尚未得到确认/);
    assert.match(chinese, /自动、反复发送选择英雄的命令/);
    assert.match(chinese, /Valve 可能将其视为自动化操作/);
    assert.match(chinese, /自行承担使用风险/);
    const changed = source.replace('repeatedly', 'once');
    assert.equal(guideText(changed), changed);
    for (const lang of ['en', 'ru'] as const) {
      window.I18N_LANG = lang;
      assert.equal(guideText(source), source);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});

/// <reference lib="dom" />
/// <reference path="../renderer/globals.d.ts" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogName, catalogLabel } from '../renderer/ui/catalog-name.ts';
import { guideText } from '../renderer/ui/guide-name.ts';

test('official item and particle phrases take priority over individual hero and word matches', () => {
  const titles = {
    'Spectre Phantom Advent V1': '幽鬼 鬼幽现世 第 1 版',
    'Spectre Phantom Ascension V2': '幽鬼 鬼幽丹辉 第 2 版',
    'Trail Of Burning Doom Frozen': '燃烧末日 冻结',
    'Frostivus Frost Trailgazer': '迎霜冰雪 Trailgazer',
    'Felicitys Blessing Class Zero': '幸福之赐 Class Zero',
    'Champions Aura 2014 Nightmare': '2014年冠军之辉 Nightmare',
    'Rubiline Sheen War Dog': '玛瑙光泽 战争 犬',
    'Greevil Vetmo': '小贪魔 Vetmo',
    'Tcoaal Blink Dagger': 'Tcoaal 闪烁匕首',
    'Pink Meteor Hammer': '粉色 陨星锤',
    'TI9 Blink Dagger': '国际邀请赛 9 闪烁匕首',
    'TI9 Blink Dagger II': '国际邀请赛 9 闪烁匕首 二',
    'Earthshaker Gold Blink Dagger': '撼地者 金色 闪烁匕首',
  };
  for (const [source, expected] of Object.entries(titles)) {
    assert.equal(catalogName(source, 'zh-CN'), expected, source);
    assert.equal(catalogLabel(source, 'zh-CN'), expected, source);
    for (const lang of ['en', 'ru']) assert.equal(catalogName(source, lang), source);
  }
  assert.equal(catalogLabel('Doom', 'zh-CN'), '末日使者');
  assert.equal(catalogLabel('Phantom Assassin', 'zh-CN'), '幻影刺客');
  assert.equal(catalogLabel('Burning Doom', 'zh-CN'), '燃烧 末日使者');
});

test('abbreviated catalog interface titles get contextual labels without turning every Play into a button', () => {
  const titles = {
    'Play Pinkv2': '粉色开始游戏按钮（第 2 版）',
    'Play Black': '黑色开始游戏按钮',
    'Play White': '白色开始游戏按钮',
    'Play Red': '红色开始游戏按钮',
    'Topbar Pink': '顶部栏 粉色',
    'Remove Innate Icon': '移除 先天技能图标',
    'Newbloom Tree': '芳晓佳节 树木',
  };
  for (const [source, expected] of Object.entries(titles)) {
    assert.equal(catalogName(source, 'zh-CN'), expected, source);
    for (const lang of ['en', 'ru']) assert.equal(catalogName(source, lang), source);
  }
  assert.equal(catalogName('Unseen Play', 'zh-CN'), 'Unseen Play');
});

test('overlay guide translates its shortcut and warning but falls back when instructions change', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { I18N_LANG: 'zh-CN' } });
  const shortcut = 'To open the overlay, press F8';
  const warning = 'This is a standard VPK, but its safety is unconfirmed. During patrol, mouse movements in a certain area may be flagged as cheating, so use it at your own risk. Not recommended for use in games on Valve servers. Read more about usage on GitHub.';
  try {
    assert.equal(guideText(shortcut), '按 F8 打开叠加层。');
    assert.match(guideText(warning), /安全性尚未得到确认/);
    assert.match(guideText(warning), /自行承担使用风险/);
    assert.match(guideText(warning), /不建议在 Valve 服务器的对局中使用/);
    assert.match(guideText(warning), /GitHub/);
    const changed = shortcut.replace('F8', 'F9');
    assert.equal(guideText(changed), changed);
    const command = '<code>dota_minimap_rune_size 500;</code>';
    assert.equal(guideText(command), command);
    for (const lang of ['en', 'ru'] as const) {
      window.I18N_LANG = lang;
      assert.equal(guideText(shortcut), shortcut);
      assert.equal(guideText(warning), warning);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});

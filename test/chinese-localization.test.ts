/// <reference lib="dom" />
/// <reference path="../renderer/globals.d.ts" />
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { catalogName, catalogLabel } from '../renderer/ui/catalog-name.ts';
import { guideText } from '../renderer/ui/guide-name.ts';

const read = (file: string) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const placeholders = (value: string) => (value.match(/\{\d+\}/g) || []).sort();

function renderer(lang: string) {
  const context = vm.createContext({ window: {}, console, localStorage: { getItem: () => lang } });
  for (const name of ['catalog', 'library', 'app', 'more']) {
    vm.runInContext(read(`renderer/locales/zh-CN-${name}.js`), context);
  }
  vm.runInContext(`{\n${read('renderer/locales/en-more.js')}\n}`, context);
  vm.runInContext(read('renderer/i18n.js') + '\nthis.english = { ...window.EN_MORE, ...EN };', context);
  return context;
}

test('Chinese covers both renderer dictionaries and the Rust pair-list dictionary with every placeholder', () => {
  const context = renderer('zh-CN');
  const nativeEnglish = Object.fromEntries(JSON.parse(read('crates/mm-core/data/i18n-en.json')));
  const nativeChinese = Object.fromEntries(JSON.parse(read('crates/mm-core/data/i18n-zh-CN.json')));
  for (const [english, chinese] of [[context.english, context.window.ZH_CN], [nativeEnglish, nativeChinese]]) {
    for (const key of Object.keys(english)) {
      assert.ok(Object.hasOwn(chinese, key), `missing Chinese: ${key}`);
      assert.ok(chinese[key].length, `empty Chinese: ${key}`);
      assert.doesNotMatch(chinese[key], /[А-Яа-яЁё]/, `Cyrillic: ${key}`);
      assert.deepEqual(placeholders(chinese[key]), placeholders(key), `placeholders: ${key}`);
    }
  }
});

test('pedestal and HUD migration strings display Chinese through the real renderer entry points', () => {
  const context = renderer('zh-CN');
  assert.equal(context.window.tr('Пьедестал'), '展示台');
  assert.equal(context.window.tr('Высота пьедестала'), '展示台高度');
  assert.equal(context.window.tr('3D-превью в окне мода'), '在模组窗口显示 3D 预览');
  assert.equal(vm.runInContext('L`Dota обновилась. HUD перенесён на новый интерфейс игры: ${"Blue HUD"}`', context),
    'Dota 2 已更新，界面皮肤已适配游戏的新界面：Blue HUD');
  assert.equal(renderer('en').window.tr('Пьедестал'), 'Pedestal');
  assert.equal(renderer('ru').window.tr('Пьедестал'), 'Пьедестал');
  assert.equal(context.window.tr('An unknown creator name'), 'An unknown creator name');
});

test('interface phrases precede ambiguous individual words and keep technical engine names', () => {
  const labels = {
    'White Match Accept Popup': '白色 接受比赛弹窗',
    'White Match Finding': '白色 寻找比赛提示',
    'Better Damage Numbers': '改进版 伤害数字',
    'Source 1 Huge Damage Display': 'Source 1 大号伤害数字',
    'HUD Studio': '界面皮肤编辑器',
    'Warcraft 3 Voices French': '魔兽争霸 3 法语配音',
    'Warcraft 3 Voices Korean': '魔兽争霸 3 韩语配音',
    'Tcoaal Search Bar': 'Tcoaal 搜索栏',
    'Noir Rose Top Bar': 'Noir 玫瑰 顶部栏',
    'Rose Overcast Search Bar': '玫瑰 Overcast 搜索栏',
    'Black King Bar': '黑皇杖',
    'Monkey King Bar': '金箍棒',
  };
  for (const [source, expected] of Object.entries(labels)) {
    assert.equal(catalogName(source, 'zh-CN'), expected, source);
    assert.equal(catalogLabel(source, 'zh-CN'), expected, source);
    for (const lang of ['en', 'ru']) assert.equal(catalogName(source, lang), source);
  }
  assert.equal(catalogLabel('Matchmaker Studio', 'zh-CN'), 'Matchmaker Studio');
});

test('guide labels keep exact-source fallback and console commands', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { I18N_LANG: 'zh-CN' } });
  try {
    assert.equal(guideText('To open the overlay, press F8'), '按 F8 打开叠加层。');
    assert.equal(guideText('To open the overlay, press F9'), 'To open the overlay, press F9');
    const command = '<code>dota_minimap_rune_size 500;</code>';
    assert.equal(guideText(command), command);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});

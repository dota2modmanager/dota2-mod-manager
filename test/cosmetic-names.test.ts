/// <reference lib="dom" />
/// <reference path="../renderer/globals.d.ts" />
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localizationTokens, cosmeticNameTable, chineseCosmeticNames } from '../src/cosmetic-names.ts';
import { buildVpk, crc32 } from '../src/vpk.ts';
import { cosmeticName, cosmeticNameMatches, setCosmeticNames } from '../renderer/ui/cosmetic-name.ts';
import { byName, matchingSets } from '../renderer/catalog/builder/logic.ts';

const language = (pairs: string) => `"lang" { "Language" "schinese" "Tokens" { ${pairs} } }`;
const table = '"items_game" { "items" { "1" { "name" "Armor of the Red Mist" "item_name" "#DOTA_Item_Red_Mist" } } }';

test('Valve token parsing handles UTF-8, UTF-16, comments, escapes and case-insensitive keys', () => {
  const text = language('// "wrong" "不应读取"\n"DOTA_Item_Red_Mist" "血雾之铠" "quoted" "a\\\"b\\nline\\tend\\\\"');
  for (const bytes of [Buffer.from('\ufeff' + text), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])]) {
    const tokens = localizationTokens(bytes);
    assert.equal(tokens.get('dota_item_red_mist'), '血雾之铠');
    assert.equal(tokens.get('quoted'), 'a"b\nline\tend\\');
    assert.equal(tokens.has('wrong'), false);
  }
  assert.equal(localizationTokens(Buffer.from('not a localization file')).size, 0);
});

test('names resolve exact item_name tokens and preserve the original schema and missing names', () => {
  const items = [{ name: 'Armor of the Red Mist', itemName: '#DOTA_Item_Red_Mist' },
    { name: 'Missing', itemName: '#missing' }, { name: 'Empty', itemName: '#empty' },
    { name: 'Unresolved', itemName: '#unresolved' }, { name: '', itemName: '#DOTA_Item_Red_Mist' }];
  const before = structuredClone(items);
  const names = cosmeticNameTable(items, new Map([['dota_item_red_mist', '血雾之铠'], ['empty', ''], ['unresolved', '#still_missing']]));
  assert.equal(names['Armor of the Red Mist'], '血雾之铠');
  assert.equal(Object.keys(names).length, 1);
  assert.deepEqual(items, before);
  const repeated = cosmeticNameTable([{ name: 'Shared', itemName: '#a' }, { name: 'Shared', itemName: '#a' },
    { name: 'Shared', itemName: '#b' }, { name: 'Shared', itemName: '#a' }], new Map([['a', '甲'], ['b', '乙']]));
  assert.equal(Object.hasOwn(repeated, 'Shared'), false, 'ambiguous canonical names keep their original label');
});

test('installed localization is cached, invalidated after a game update, and optional offline', (t) => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-cn-names-'));
  t.after(() => fs.rmSync(game, { recursive: true, force: true }));
  fs.mkdirSync(path.join(game, 'dota'));
  const pak = path.join(game, 'dota', 'pak01_dir.vpk');
  const write = (pairs: string, includeDota = true) => {
    const files = new Map([['resource/localization/items_schinese.txt', language(pairs)]]);
    if (includeDota) files.set('resource/localization/dota_schinese.txt', language('"DOTA_Item_Red_Mist" "旧名称"'));
    fs.writeFileSync(pak, buildVpk([...files].map(([file, text]) => {
      const data = Buffer.from(text);
      return { ext: 'txt', folder: path.posix.dirname(file), name: path.posix.basename(file, '.txt'), data, preload: Buffer.alloc(0), crc: crc32(data) };
    })));
  };
  write('"DOTA_Item_Red_Mist" "血雾之铠"');
  const first = chineseCosmeticNames(game, table);
  assert.equal(first['Armor of the Red Mist'], '血雾之铠', 'items tokens take precedence');
  assert.equal(chineseCosmeticNames(game, table), first, 'same game build reuses the dictionary');
  write('"DOTA_Item_Red_Mist" "更新后的官方名称"', false);
  assert.equal(chineseCosmeticNames(game, table)['Armor of the Red Mist'], '更新后的官方名称');
  fs.writeFileSync(pak, buildVpk([]));
  assert.equal(Object.keys(chineseCosmeticNames(game, table)).length, 0);
  assert.deepEqual(chineseCosmeticNames(path.join(game, 'missing'), table), {});
});

test('Chinese labels and bilingual searches do not change item ids, icon keys or English/Russian labels', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { I18N_LANG: 'zh-CN' }, configurable: true });
  try {
    setCosmeticNames({ 'Armor of the Red Mist': '血雾之铠', 'Red Mist Set': '血雾套装' });
    const option = { id: '1', name: 'Armor of the Red Mist' };
    assert.equal(cosmeticName(option.name), '血雾之铠');
    assert.equal(cosmeticName('Missing'), 'Missing');
    assert.equal(cosmeticName('__proto__'), '__proto__');
    for (const q of ['血雾', 'red mist', ' 血雾 Armor ', '']) assert.equal(cosmeticNameMatches(option.name, q), true);
    assert.equal(cosmeticNameMatches(option.name, '别的饰品'), false);
    assert.equal(byName([option], '血雾')[0], option);
    const set = { id: 's', name: 'Red Mist Set', heroLabel: 'Axe', fit: 1, pieces: [{ slot: 'item:axe:armor', itemId: '1', name: option.name, fits: true }] };
    assert.equal(matchingSets([set], '血雾套装')[0], set);
    assert.equal(matchingSets([set], '血雾之铠')[0], set);
    assert.equal(matchingSets([set], 'missing').length, 0);
    assert.equal(option.name, 'Armor of the Red Mist');
    for (const lang of ['en', 'ru']) {
      window.I18N_LANG = lang as 'en' | 'ru';
      assert.equal(cosmeticName(option.name), option.name);
      assert.equal(cosmeticNameMatches(option.name, '血雾'), false);
    }
  } finally {
    setCosmeticNames({});
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});

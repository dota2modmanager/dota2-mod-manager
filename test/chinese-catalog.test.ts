/// <reference lib="dom" />
/// <reference path="../renderer/globals.d.ts" />
import test from 'node:test';
import assert from 'node:assert/strict';
import translations from '../renderer/locales/zh-CN-mod-names.json' with { type: 'json' };
import guides from '../renderer/locales/zh-CN-guide-text.json' with { type: 'json' };
import { catalogName, catalogLabel } from '../renderer/ui/catalog-name.ts';
import { guideText } from '../renderer/ui/guide-name.ts';
import { catalogMatchesSearch } from '../renderer/ui/hero-name.ts';
import { matchesSearch } from '../renderer/library/order.ts';
import type { LibRecord } from '../renderer/library/types.ts';
import { state } from '../renderer/core/store.ts';
import { catName } from '../renderer/core/categories.ts';
import { effectNames } from '../renderer/core/records.ts';
import type { CosmeticSlot } from '../renderer/catalog/types.ts';

test('catalog titles cover the inspected catalog and retain only technical/name identifiers', () => {
  assert.equal(Object.keys(translations).length, 1565);
  for (const [original, translated] of Object.entries(translations)) {
    assert.match(translated, /[\u3400-\u9fff]/, original);
    const remaining = translated.replace(/M1A2|Windows XP|Dota2?|Linux|Source|VPK|Steam|Discord|Eul/gi, '');
    assert.doesNotMatch(remaining, /[A-Za-zА-Яа-яЁё]/, original + ': ' + translated);
    assert.equal(catalogName(original, 'zh-CN'), translated);
    for (const lang of ['en', 'ru']) assert.equal(catalogName(original, lang), original);
  }
});

test('hero sounds, skills, styles and categories display understandable Chinese', () => {
  assert.equal(catalogName('Largo Serega Pirat', 'zh-CN'), '朗戈 谢廖加·海盗');
  assert.equal(catalogName('Witch Doctor True Maledict', 'zh-CN'), '巫医 真·巫蛊咒术');
  assert.equal(catalogName('Enigma Black Hole Kate', 'zh-CN'), '谜团 黑洞 凯特');
  assert.equal(catalogName('Witch Doctor Death Ward', 'zh-CN'), '巫医 死亡守卫');
  assert.equal(catalogName('Nature Prophet Taunt', 'zh-CN'), '自然先知 嘲讽');
  assert.equal(catalogName('Techies Bismillah Blast Off!', 'zh-CN'), '工程师 比斯米拉 爆破起飞！');
  assert.equal(catalogName('TI9 Euls Scepter', 'zh-CN'), '国际邀请赛 9 Eul的神圣法杖');
  assert.equal(catalogLabel('Style III', 'zh-CN'), '款式三');
  assert.equal(catalogLabel('High Five', 'zh-CN'), '击掌');
  assert.equal(catalogLabel('Parts', 'zh-CN'), '部件');
  assert.equal(catalogLabel('HUD', 'zh-CN'), '界面皮肤');
  assert.equal(catalogName('__proto__', 'zh-CN'), '__proto__');
  assert.equal(catalogName('Unseen author title', 'ru'), 'Unseen author title');
});

test('bilingual catalog and library searches keep records and original style keys intact', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousSlots = state.cosmeticSlots;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { I18N_LANG: 'zh-CN' } });
  try {
    const rec = { id: 'canonical', name: 'Witch Doctor True Maledict', styleLabel: 'Style II', members: [] } as unknown as LibRecord;
    const before = structuredClone(rec);
    const cachedSlot = { slot: 'item:pudge:weapon', label: 'Pudge · 武器', effects: [{ id: 'canonical-effect', name: 'Witch Doctor Death Ward' }] };
    state.cosmeticSlots = [cachedSlot] as unknown as CosmeticSlot[];
    assert.equal(catName('cosmetic:item:pudge:weapon'), '帕吉 · 武器');
    assert.equal(effectNames({ categoryId: 'cosmetics', slot: cachedSlot.slot, effectId: 'canonical-effect' }), ' · 巫医 死亡守卫');
    assert.equal(cachedSlot.label, 'Pudge · 武器');
    assert.equal(cachedSlot.effects[0].id, 'canonical-effect');
    for (const q of ['巫医', '巫蛊咒术', 'Witch Doctor', '巫医 Maledict']) {
      assert.equal(catalogMatchesSearch(rec.name, q), true);
      assert.equal(matchesSearch(rec, q), true);
    }
    assert.equal(matchesSearch(rec, '黑洞'), false);
    assert.deepEqual(rec, before);
    window.I18N_LANG = 'en';
    assert.equal(matchesSearch(rec, '巫蛊咒术'), false);
    assert.equal(matchesSearch(rec, 'maledict'), true);
    assert.equal(catalogMatchesSearch('Witch Doctor True Maledict Hero sounds', 'Maledict Hero'), true);
  } finally {
    state.cosmeticSlots = previousSlots;
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('guide translation retains links and executable commands and falls back on changed content', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { I18N_LANG: 'zh-CN' } });
  try {
    const links = (html: string) => [...html.matchAll(/href=["']([^"']*)["']/g)].map(m => m[1]);
    for (const [english, chinese] of Object.entries(guides)) {
      assert.equal(guideText(english), chinese);
      assert.deepEqual(links(chinese), links(english));
      for (const code of english.matchAll(/<code>([^<]*)<\/code>/g)) {
        if (/^(chmod |\.\/|-language |\+exec |Steam\\|steamapps\\|dota_\d|autoexec\.cfg|zxc\.webm|pak\d)/.test(code[1])) {
          assert.ok(chinese.includes(code[0]), 'Command/path changed: ' + code[0]);
        }
      }
    }
    assert.equal(guideText('New instructions from the catalog'), 'New instructions from the catalog');
    window.I18N_LANG = 'en';
    assert.equal(guideText('Unpacking VPK'), 'Unpacking VPK');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window');
  }
});

// An English user must never meet a Russian string.
//
// Russian is the source language here: the text in the code is the key, and English is looked
// up from it. A key with no English entry falls back to Russian and nothing crashes, which is
// exactly why it survives review - the app works, it just speaks the wrong language in one
// dialog. tools/check-i18n.js reads every call site and every dictionary and finds those, and
// this test is what makes it run on a pull request instead of on somebody's memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

test('every Russian string has an English twin', () => {
  const script = path.join(__dirname, '..', 'tools', 'check-i18n.js');
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });

  // The checker prints the file, the line and the string for each gap, so its own output is
  // the failure message. Repeating it here in a nicer shape would only lose the line numbers.
  assert.equal(run.status, 0, `\n${run.stdout}${run.stderr}`);
});

test('rejects an unchanged English twin', () => {
  const { checkTranslations } = require('../tools/check-i18n');

  const result = checkTranslations({
    Настройки: 'Настройки',
  });

  assert.deepEqual(result.unchanged, ['Настройки']);
});

test('rejects an English twin containing Cyrillic', () => {
  const { checkTranslations } = require('../tools/check-i18n');

  const result = checkTranslations({
    Установить: 'Установить мод',
  });

  assert.deepEqual(result.cyrillic, [
    { ru: 'Установить', en: 'Установить мод' },
  ]);
});

test('a twin that reads the same in both languages is allowed by name, and nothing else is', () => {
  const { checkTranslations } = require('../tools/check-i18n');
  const result = checkTranslations({ 'Dota 2': 'Dota 2', VPK: 'VPK', '18+': '18+', Моды: 'Mods', Шейдеры: 'Шейдеры' });
  assert.deepEqual(result, { unchanged: ['Шейдеры'], cyrillic: [] });
});

test('the report names the dictionary, each untranslated twin, and counts them', () => {
  const { translationReport } = require('../tools/check-i18n');
  const report = translationReport({ Настройки: 'Настройки', Установить: 'Установить мод', Моды: 'Mods' }, 'renderer/i18n.js');
  assert.equal(report.count, 2);
  assert.deepEqual(report.lines, [
    '\n1 English twin(s) in renderer/i18n.js are the Russian key unchanged:',
    '  "Настройки"',
    '\n1 English twin(s) in renderer/i18n.js still contain Cyrillic:',
    '  "Установить": "Установить мод"',
  ]);
  assert.deepEqual(translationReport({ Моды: 'Mods' }, 'src/i18n.ts'), { count: 0, lines: [] });
});


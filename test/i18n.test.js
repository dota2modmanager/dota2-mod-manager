// An English user must never meet a Russian string.
//
// Russian is the source language here: the text in the code is the key, and English is looked
// up from it. A key with no English entry falls back to Russian and nothing crashes, which is
// exactly why it survives review - the app works, it just speaks the wrong language in one
// dialog. tools/dev/check-i18n.js reads every call site and every dictionary and finds those, and
// this test is what makes it run on a pull request instead of on somebody's memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

test('every Russian string has an English twin', () => {
  const script = path.join(__dirname, '..', 'tools', 'dev', 'check-i18n.js');
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });

  // The checker prints the file, the line and the string for each gap, so its own output is
  // the failure message. Repeating it here in a nicer shape would only lose the line numbers.
  assert.equal(run.status, 0, `\n${run.stdout}${run.stderr}`);
});

test('the check reads every Rust module of the core and the shell', () => {
  /* It read src/*.js only, and when src/ became TypeScript the main side shrank to main.js
     without a word: "every string has a twin" held because nothing was being looked at. The
     main side is Rust now, in folders, and every one of them has to be read. */
  const { SIDES, scanRust } = require('../tools/dev/check-i18n');
  const main = SIDES.find((s) => s.name === 'main');
  assert.equal(main.dict, 'crates/mm-core/data/i18n-en.json');
  assert.ok(main.files.length > 150, `the Rust modules were found (${main.files.length})`);
  for (const f of ['crates/mm-core/src/game/patcher.rs', 'crates/mm-core/src/owner/mod.rs', 'src-tauri/src/main.rs']) assert.ok(main.files.includes(f), f);
  const fs = require('fs');
  const calls = main.files.reduce((n, f) => n + scanRust(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ['t']).length, 0);
  assert.ok(calls > 200, `the t("...") calls were found (${calls})`);
});

test('a Rust call is read with its escapes, and a key in a variable is left alone', () => {
  const { scanRust } = require('../tools/dev/check-i18n');
  const src = [
    'let a = t("Не найден {0}", &[x]);',
    String.raw`let b = crate::i18n::t("Строка \"в кавычках\"\n", &[]);`,
    'let c = t(line, &[]);',
  ].join('\n');
  assert.deepEqual(scanRust(src, ['t']).map((h) => [h.key, h.line]), [['Не найден {0}', 1], ['Строка "в кавычках"\n', 2]]);
});

test('a string after a JSX closing tag is still found, and a real regex is still skipped', () => {
  // "</span>" read as the start of a regex swallowed the arcana window's L`` up to the next slash
  const { scan } = require('../tools/dev/check-i18n');
  const keys = (src) => scan(src, ['L']).map((h) => h.key);
  assert.deepEqual(keys('<b><span className="ms">check</span>{L`Установлено`}</b>'), ['Установлено']);
  assert.deepEqual(keys('<input value={x} />{L`Свой цвет`}'), ['Свой цвет']);
  assert.deepEqual(keys('const re = /L`нет`/; const s = L`да`;'), ['да']);
});

test('rejects an unchanged English twin', () => {
  const { checkTranslations } = require('../tools/dev/check-i18n');

  const result = checkTranslations({
    Настройки: 'Настройки',
  });

  assert.deepEqual(result.unchanged, ['Настройки']);
});

test('rejects an English twin containing Cyrillic', () => {
  const { checkTranslations } = require('../tools/dev/check-i18n');

  const result = checkTranslations({
    Установить: 'Установить мод',
  });

  assert.deepEqual(result.cyrillic, [
    { ru: 'Установить', en: 'Установить мод' },
  ]);
});

test('a twin that reads the same in both languages is allowed by name, and nothing else is', () => {
  const { checkTranslations } = require('../tools/dev/check-i18n');
  const result = checkTranslations({ 'Dota 2': 'Dota 2', VPK: 'VPK', '18+': '18+', Моды: 'Mods', Шейдеры: 'Шейдеры' });
  assert.deepEqual(result, { unchanged: ['Шейдеры'], cyrillic: [] });
});

test('the report names the dictionary, each untranslated twin, and counts them', () => {
  const { translationReport } = require('../tools/dev/check-i18n');
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


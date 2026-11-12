/* The window's language on the first start (src/ui-lang.ts): the system's, first match wins. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { uiLangFor } from '../src/ui-lang.ts';

test('a Russian, Ukrainian or Kazakh system opens in Russian, a Chinese one in Chinese', () => {
  assert.equal(uiLangFor(['ru-RU']), 'ru');
  assert.equal(uiLangFor(['uk-UA', 'en-US']), 'ru');
  assert.equal(uiLangFor(['kk']), 'ru');
  assert.equal(uiLangFor(['zh-Hans-CN']), 'zh-CN');
});

test('the first language the app knows wins, and the rest is English', () => {
  assert.equal(uiLangFor(['en-GB', 'ru-RU']), 'en');
  assert.equal(uiLangFor(['de-DE', 'ru-RU']), 'ru', 'German has no window of its own: the next one counts');
  assert.equal(uiLangFor(['de-DE']), 'en');
  assert.equal(uiLangFor([]), 'en');
});

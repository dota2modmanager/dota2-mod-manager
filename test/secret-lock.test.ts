/* The site and the window hold the two halves of one thing: the site hands out a key
 * (site/src/scripts/key.ts) and the window keeps a lock (renderer/ui/secret-lock.ts). They are
 * written apart, in two builds, so this is the one place that says they still fit. The key is
 * taken from the site's own code rather than written here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { theKey } from '../site/src/scripts/key.ts';
import { opens, readings } from '../renderer/ui/secret-lock.ts';

const RU = 'йцукенгшщзфывапролдячсмить';
const EN = 'qwertyuiopasdfghjklzxcvbnm';
/** what the same keys type with the keyboard left on Russian */
const onRussianKeys = (s: string) => [...s.toLowerCase()].map((c) => { const i = EN.indexOf(c); return i < 0 ? c : RU[i]; }).join('');

test('the key the site gives opens the window, however it is typed', async () => {
  const key = theKey();
  assert.match(key, /^[A-Z]+(-[A-Z]+)+$/, 'the key reads as words joined by dashes');
  for (const typed of [key, key.toLowerCase(), key.replaceAll('-', ' '), `  ${key.replaceAll('-', '')} `, onRussianKeys(key)]) {
    assert.equal(await opens(typed), true, `"${typed}" does not open it`);
  }
});

test('nothing else opens it', async () => {
  const key = theKey();
  for (const typed of ['', '   ', 'pumpkin', key.slice(0, -1), `${key}X`, key.split('-').reverse().join('-')]) {
    assert.equal(await opens(typed), false, `"${typed}" opens it`);
  }
});

test('a Cyrillic letter that looks Latin is read as the Latin one', () => {
  // Т, Е, Х typed in place of T, E, X
  assert.ok(readings('ТЕХ').includes('TEX'));
});

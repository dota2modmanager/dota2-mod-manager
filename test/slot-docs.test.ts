/* The load order the documents describe is the one the code hands out.
 *
 * On 2026-10-11 an outside review read the README's "slots 10 to 99, pak02 to pak09 for what must
 * load first" against the 2.8.0 release notes' 02-29 and 30 up, and the site's VPK page still said
 * a mod "marked as priority" goes to 02-09. The code had moved on 2026-09-29 (src/slot-zones.ts);
 * nothing tied the words to it. Now the numbers in the README, its Russian twin and the site's VPK
 * page are read against the constants.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PRIORITY_SLOTS, NORMAL_FIRST, APP_PAK } from '../src/slot-zones.ts';
import { RESERVED_PAKS } from '../src/minify.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pak = (n: number) => `pak${String(n).padStart(2, '0')}`;

const DOCS = ['README.md', 'README.ru.md', 'site/src/i18n/docs.ts'];

test('every document names the slots the code hands out', () => {
  for (const rel of DOCS) {
    const text = read(rel);
    for (const n of [PRIORITY_SLOTS[0], PRIORITY_SLOTS[1], NORMAL_FIRST, APP_PAK, RESERVED_PAKS[0], RESERVED_PAKS[RESERVED_PAKS.length - 1]]) {
      assert.ok(text.includes(pak(n)), `${rel} does not name ${pak(n)}`);
    }
  }
});

test('no document keeps the layout from before the two parts', () => {
  const old = [/pak02[^\n]{0,8}pak09/, /pak10[^\n]{0,8}pak99/, /slots 10 to 99/i, /с 10 по 99/, /mark as priority/i, /помечено приоритетным/];
  for (const rel of DOCS) {
    const text = read(rel);
    for (const re of old) assert.doesNotMatch(text, re, `${rel} still says ${re}`);
  }
});

/* The ready-made presets (config/presets.json, issue #391): signed with the remote config's key and
 * read through src/ready-presets-format.ts. The committed list has to verify, be LF on disk, and
 * survive its own checks whole; the checks have to drop what a hand-edited entry gets wrong; and
 * every preset has to travel as a link the app decodes, which is how the site offers it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { verify } from '../src/catalog-signature.ts';
import { CONFIG_PUBLIC_KEY } from '../src/remote-config.ts';
import { normalizeReady, MAX_PRESETS } from '../src/ready-presets-format.ts';
import { decodePresetLink, encodePresetLink } from '../src/preset-link.ts';

const file = path.join(import.meta.dirname, '..', 'config', 'presets.json');

test('the committed list is the one the pinned key signed, in LF', () => {
  const bytes = fs.readFileSync(file);
  assert.ok(verify(bytes, fs.readFileSync(`${file}.sig`, 'utf-8'), CONFIG_PUBLIC_KEY),
    'config/presets.json does not match its .sig. Re-sign:\n  CATALOG_KEY=<private key> node tools/sign-catalog.js config/presets.json');
  assert.ok(!bytes.includes(0x0d), 'config/presets.json has CRLF line endings');
});

test('every committed preset passes the checks whole', () => {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const list = normalizeReady(raw);
  assert.equal(list.length, raw.presets.length);
  list.forEach((p, i) => {
    assert.equal(p.mods.length, raw.presets[i].mods.length, `${p.id} lost a mod to the checks`);
    assert.ok(p.ru && p.en && p.about.ru && p.about.en, `${p.id} needs both languages`);
  });
});

test('a bad entry is dropped, not trusted', () => {
  const list = normalizeReady({
    version: 1,
    presets: [
      { id: 'Has Spaces', ru: 'x', mods: [{ category: 'river', name: 'Blue River' }] },
      { id: 'empty', ru: 'Пусто', mods: [] },
      { id: 'one', en: 'One', mods: [{ category: 'river', name: 'Blue River' }, { name: 'no category' }, 'text'] },
      { id: 'one', ru: 'Дубль', mods: [{ category: 'river', name: 'Red River' }] },
    ],
  });
  assert.deepEqual(list.map((p) => p.id), ['one']);
  assert.equal(list[0].ru, 'One', 'a missing language falls back to the other');
  assert.deepEqual(list[0].mods, [{ categoryId: 'river', name: 'Blue River', styleLabel: null }]);
  assert.deepEqual(normalizeReady({ version: 2, presets: [] }), []);
  assert.deepEqual(normalizeReady('nonsense'), []);
  const many = { version: 1, presets: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, en: 'P', mods: [{ category: 'river', name: 'Blue River' }] })) };
  assert.equal(normalizeReady(many).length, MAX_PRESETS);
});

test('every preset goes into a link and comes back with the same mods', () => {
  for (const p of normalizeReady(JSON.parse(fs.readFileSync(file, 'utf-8')))) {
    const back = decodePresetLink(encodePresetLink({ name: p.en, mods: p.mods }).web);
    assert.equal(back.name, p.en);
    assert.deepEqual(back.mods.map((m) => m.kind === 'catalog' && [m.categoryId, m.name, m.styleLabel]),
      p.mods.map((m) => [m.categoryId, m.name, m.styleLabel]));
  }
});

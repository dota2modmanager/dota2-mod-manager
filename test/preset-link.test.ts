/* A whole build squeezed into something you can paste into a Discord message.
 *
 * Two reasons this needs tests. It is a codec, so a round trip is the cheap and total check
 * that it works. And it is the one place in the app that parses a string a stranger sent you:
 * a link arrives from chat, from a browser, from the operating system's URL handler, and
 * whatever is inside it becomes a list of mods the app offers to install. Every guard below -
 * the length caps, the inflate-bomb limit, the shape check - exists because the alternative is
 * trusting that.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

import { SCHEME, encodePresetLink, decodePresetLink, type LinkMod } from '../src/preset-link.ts';

/* The errors are user-facing strings, and src/i18n answers in English unless the app has told
 * it otherwise, which nothing here does. Matched by their English wording rather than by a
 * pattern loose enough to accept any error at all - a test that only checks "it threw" would
 * pass on a typo in the guard. */
const NOT_A_LINK = /does not look like a preset link/i;
const DAMAGED = /link is damaged/i;
const TOO_MANY = /too many mods/i;

/** The mods of a decoded build as catalog mods, failing the test on any that came back as a cosmetic. */
function catalogOnly(mods: LinkMod[]) {
  return mods.map((m) => {
    assert.ok(m.kind === 'catalog', `a ${m.kind} mod came back where a catalog one was sent`);
    return m;
  });
}

const catalogMod = (name: string, over: { categoryId?: string; styleLabel?: string | null } = {}) => ({ kind: 'catalog', categoryId: 'heroes', name, styleLabel: null, ...over });

test('a build survives the round trip, and comes back in the same order', () => {
  const mods = [
    catalogMod('Crystal Maiden'),
    catalogMod('Juggernaut', { styleLabel: 'Red' }),
    catalogMod('River of Blood', { categoryId: 'river' }),
  ];
  const { code, web, direct } = encodePresetLink({ name: 'My build', author: 'misha', mods });

  assert.match(code, /^[A-Za-z0-9_-]+$/, 'base64url, so it survives being pasted anywhere');
  assert.ok(web.endsWith(`#${code}`), 'the code rides in the fragment, which no server sees');
  assert.equal(direct, `${SCHEME}://preset/${code}`);

  const back = decodePresetLink(direct);
  assert.equal(back.name, 'My build');
  assert.equal(back.author, 'misha');
  assert.deepEqual(catalogOnly(back.mods).map((m) => [m.categoryId, m.name, m.styleLabel]), [
    ['heroes', 'Crystal Maiden', null],
    ['heroes', 'Juggernaut', 'Red'],
    ['river', 'River of Blood', null],
  ]);
});

test('a free cosmetic travels too, as a slot and an item id', () => {
  const mods = [{ kind: 'cosmetic', slot: 'courier', itemId: '12345', name: 'Baby Roshan' }];
  const back = decodePresetLink(encodePresetLink({ name: 'Cosmetics', mods }).code);
  assert.deepEqual(back.mods, [{ kind: 'cosmetic', slot: 'courier', itemId: '12345', name: 'Baby Roshan', effectId: '' }]);
});

test('an item cosmetic keeps its effect id through the link', () => {
  const mods = [{ kind: 'cosmetic', slot: 'items', itemId: '9455', name: 'Golden Full-Bore Bonanza', effectId: 'frostbloom' }];
  const back = decodePresetLink(encodePresetLink({ name: 'Items', mods }).code);
  assert.deepEqual(back.mods, [{ kind: 'cosmetic', slot: 'items', itemId: '9455', name: 'Golden Full-Bore Bonanza', effectId: 'frostbloom' }]);
});

test('a cosmetic missing its slot or its id is dropped rather than half-installed', () => {
  const half = [
    { kind: 'cosmetic', slot: '', itemId: '1', name: 'no slot' },
    { kind: 'cosmetic', slot: 'ward', itemId: '', name: 'no id' },
    { kind: 'cosmetic', slot: 'ward', itemId: '7', name: 'fine' },
  ];
  const back = decodePresetLink(encodePresetLink({ name: 'x', mods: half }).code);
  assert.deepEqual(back.mods.map((m) => m.name), ['fine']);
});

test('the link is small enough to paste', () => {
  // thirty catalog mods is a big build; the point of the format is that it still fits in a
  // chat message rather than becoming a file
  const mods = Array.from({ length: 30 }, (_, i) => catalogMod(`Some Mod Number ${i}`));
  const { code } = encodePresetLink({ name: 'Thirty', mods });
  assert.ok(code.length < 1400, `expected under 1400 characters, got ${code.length}`);
});

// ---------- what arrives from chat is not clean ----------

test('the code is found inside whatever chat wrapped it in', () => {
  const { code, web, direct } = encodePresetLink({ name: 'Wrapped', mods: [catalogMod('A')] });
  const wrapped = [
    code,
    web,
    direct,
    `  ${direct}  `,
    `<${direct}>`,
    `\`${code}\``,
    `"${web}"`,
    `${direct}/`,          // Windows hands a clicked link over with a trailing slash
    `${web}/`,
  ];
  for (const input of wrapped) {
    assert.equal(decodePresetLink(input).name, 'Wrapped', `failed on ${JSON.stringify(input)}`);
  }
});

test('something that is not a link says so, rather than throwing something unreadable', () => {
  for (const junk of ['', '   ', 'hello there', 'https://example.com/', null, undefined, 'a b c']) {
    assert.throws(() => decodePresetLink(junk), NOT_A_LINK, `on ${JSON.stringify(junk)}`);
  }
});

test('a code of the right shape but the wrong contents is refused', () => {
  const ofJson = (obj: unknown) => zlib.deflateRawSync(Buffer.from(JSON.stringify(obj))).toString('base64url');
  assert.throws(() => decodePresetLink('bm90IGRlZmxhdGVk'), DAMAGED, 'not deflate');
  assert.throws(() => decodePresetLink(zlib.deflateRawSync(Buffer.from('{not json')).toString('base64url')), DAMAGED);
  assert.throws(() => decodePresetLink(ofJson({ v: 2, m: [] })), DAMAGED, 'a version we do not know');
  assert.throws(() => decodePresetLink(ofJson({ v: 1 })), DAMAGED, 'no mod list at all');
  assert.throws(() => decodePresetLink(ofJson({ v: 1, m: 'not an array' })), DAMAGED);
});

test('a build with more mods than anybody has is refused before it is read', () => {
  const many = Array.from({ length: 501 }, (_, i) => ['heroes', `m${i}`]);
  const code = zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: 1, n: 'huge', m: many }))).toString('base64url');
  assert.throws(() => decodePresetLink(code), TOO_MANY);
});

test('a small code that inflates to megabytes is refused rather than decompressed', () => {
  // The compression bomb. Half a megabyte of one repeated character deflates to a few hundred
  // bytes, and without maxOutputLength the app would happily allocate the lot from a link
  // somebody pasted into a chat.
  const bomb = zlib.deflateRawSync(Buffer.alloc(4 * 1024 * 1024, 0x41), { level: 9 }).toString('base64url');
  assert.ok(bomb.length < 20000, 'the point of a bomb is that it is small');
  assert.throws(() => decodePresetLink(bomb), DAMAGED);
});

test('long strings are cut rather than carried, however they arrived', () => {
  const long = 'x'.repeat(5000);
  const code = zlib.deflateRawSync(Buffer.from(JSON.stringify({
    v: 1, n: long, a: long, m: [[long, long, long]],
  }))).toString('base64url');
  const back = decodePresetLink(code);
  assert.equal(back.name.length, 120);
  assert.equal(back.author.length, 80);
  const [first] = catalogOnly(back.mods);
  assert.equal(first.categoryId.length, 60);
  assert.equal(first.name.length, 300);
  assert.equal(first.styleLabel?.length, 300);
});

test('entries that are not two strings are dropped, not guessed at', () => {
  const code = zlib.deflateRawSync(Buffer.from(JSON.stringify({
    v: 1,
    n: 'Mixed',
    m: [
      ['heroes', 'good'],
      ['heroes'],                  // one string
      [42, 'number first'],
      'not an array',
      null,
      ['heroes', 7],               // second not a string
      ['heroes', 'also good'],
    ],
  }))).toString('base64url');
  assert.deepEqual(decodePresetLink(code).mods.map((m) => m.name), ['good', 'also good']);
});

test('a build with no name and no author still opens', () => {
  const back = decodePresetLink(encodePresetLink({ name: '', mods: [catalogMod('A')] }).code);
  assert.ok(back.name.length > 0, 'given a name rather than shown as blank');
  assert.equal(back.author, '');
});

test('the shared link points at a page this project actually serves', () => {
  // The wrapper page moved off GitHub Pages on 2026-09-10, because a preset is the one thing
  // people paste to each other and a link that will not open for anybody who cannot reach
  // GitHub is not a shared preset. Three things have to agree or a shared link goes nowhere:
  // the address the app writes, the page in the repository, and the build step that deploys
  // it to that address.
  const root = path.join(import.meta.dirname, '..');

  const url = encodePresetLink({ name: 'x', mods: [{ categoryId: 'heroes', name: 'A' }] }).web || '';
  const host = /^https:\/\/([^/]+)\//.exec(url)?.[1];
  assert.ok(host, `no shareable link came back: ${url}`);

  assert.ok(fs.existsSync(path.join(root, 'docs', 'p', 'index.html')), 'the page itself is gone');

  const build = JSON.parse(fs.readFileSync(path.join(root, 'site', 'package.json'), 'utf-8')).scripts.build;
  const deployed = build.includes('preset-page');
  assert.ok(
    host === 'thefleece.github.io' || deployed,
    `links point at ${host}, and nothing in the site build puts the page there`,
  );
});

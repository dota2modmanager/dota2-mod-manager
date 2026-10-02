// Which note the My mods screen shows about Minify, fed with what src/minify.ts really says
// about each machine rather than with hand-made objects, so the two cannot drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';

import { readMinify as  read, MINIFY_FOLDER, MINIFY_BORROWED } from '../src/minify.ts';
import { DOTA_LANGUAGES } from '../src/gamelang.ts';

const load = () => import('../renderer/core/minify-notice.ts');
// never the Minify installed on the machine running the tests
// a test that names no folder of ours asks about a machine where this app has none
const readMinify = (p: Partial<Parameters<typeof read>[0]>) => read({ config: null, gameLanguages: DOTA_LANGUAGES, ...p } as Parameters<typeof read>[0]);
const folder = (suffix: string, modFiles = 0, official = false) => ({ suffix, official, valveContent: false, modFiles });

test('no Minify, no note', async () => {
  const { minifyNotice } = await load();
  const m = readMinify({ folders: [folder('russian', 4, true)], audio: 'russian', ourFolder: 'russian', ourMods: 4 });
  assert.equal(minifyNotice(m, 4), null);
});

test('the game reads our folder before any mod of ours is in it: a note, not a warning', async () => {
  // The machine that showed "the game reads dota_russian and there are no mods in it; ours are
  // in dota_russian": a fresh install next to a working Minify (2026-09-24).
  const { minifyNotice } = await load();
  const m = readMinify({
    folders: [folder('russian', 0, true), folder(MINIFY_BORROWED, 6)],
    audio: 'russian', ourFolder: 'russian', ourMods: 0,
  });
  assert.equal(m.live, 'neither', 'src/minify.ts calls this nobody\'s mods, which is true');
  assert.deepEqual(minifyNotice(m, 0), { kind: 'info', case: 'ours-read' });
});

test('the game reads our folder and ours are in it: the same note', async () => {
  const { minifyNotice } = await load();
  const m = readMinify({
    folders: [folder('russian', 5, true), folder(MINIFY_BORROWED, 6)],
    audio: 'russian', ourFolder: 'russian', ourMods: 5,
  });
  assert.deepEqual(minifyNotice(m, 5), { kind: 'info', case: 'ours-read' });
});

test('the game reads Minify\'s mods: ours sit dark, a warning', async () => {
  const { minifyNotice } = await load();
  const m = readMinify({
    folders: [folder('russian', 5, true), folder(MINIFY_BORROWED, 6)],
    audio: MINIFY_BORROWED, ourFolder: 'russian', ourMods: 5,
  });
  assert.deepEqual(minifyNotice(m, 5), { kind: 'warn', case: 'minify-live' });
});

test('one folder for both: they work side by side', async () => {
  const { minifyNotice } = await load();
  const m = readMinify({
    folders: [folder(MINIFY_BORROWED, 9)],
    audio: MINIFY_BORROWED, ourFolder: MINIFY_BORROWED, ourMods: 3,
  });
  assert.equal(minifyNotice(m, 3)?.case, 'shared');
});

test('the game\'s language is not known: no claim about which folder it reads', async () => {
  const { minifyNotice } = await load();
  const m = readMinify({
    folders: [folder('russian', 5, true), folder(MINIFY_BORROWED, 6)],
    audio: null, ourFolder: 'russian', ourMods: 5,
  });
  assert.equal(m.live, 'unknown');
  assert.deepEqual(minifyNotice(m, 5), { kind: 'info', case: 'unknown' }, 'it used to say "the game reads our folder" here');
});

test('the game reads Minify\'s folder and it is empty: a warning only when ours are the ones missing out', async () => {
  const { minifyNotice } = await load();
  const at = (ourMods: number) => readMinify({
    folders: [folder('russian', ourMods, true), folder(MINIFY_BORROWED, 0)],
    audio: MINIFY_BORROWED, ourFolder: 'russian', ourMods,
    // an empty borrowed folder is not proof of Minify on its own; its config says where it writes
    config: { folder: MINIFY_BORROWED },
  });
  assert.deepEqual(minifyNotice(at(3), 3), { kind: 'warn', case: 'minify-empty' });
  assert.deepEqual(minifyNotice(at(0), 0), { kind: 'info', case: 'minify-empty' });
});

test('the game reads a third folder nobody filled: a warning', async () => {
  const { minifyNotice } = await load();
  const m = readMinify({
    folders: [folder('russian', 5, true), folder(MINIFY_BORROWED, 6), folder('english', 0, true)],
    audio: 'english', ourFolder: 'russian', ourMods: 5,
  });
  assert.deepEqual(minifyNotice(m, 5), { kind: 'warn', case: 'elsewhere' });
});

test('its own locale, which no game language names: nothing of it loads, ours are unaffected', async () => {
  const { minifyNotice } = await load();
  const m = readMinify({
    folders: [folder('russian', 7, true), folder(MINIFY_FOLDER, 3)],
    audio: 'russian', ourFolder: 'russian', ourMods: 7,
  });
  assert.deepEqual(minifyNotice(m, 7), { kind: 'info', case: 'unmountable' });
});

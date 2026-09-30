/* What the window is handed as "settings".
 *
 * `settings:set` used to answer with the bare store, and the window keeps whatever it is handed,
 * so saving any one setting dropped `dotaPathValid` from its copy: from the next repaint the
 * catalog said Dota was not installed and every install refused. Both handlers now answer with
 * this view, and these hold what it has to carry whoever asks.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { settingsViewFor } from '../src/settings-view.ts';
import type { StoredSettings } from '../src/settings.ts';
import type { LibRecord } from '../src/types.ts';

// Minify's own config is read off this machine's LOCALAPPDATA. Pointed at an empty folder, so the
// answer does not depend on whether the person running the tests uses Minify.
const NO_MINIFY = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-nominify-'));
const REAL_LOCAL = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = NO_MINIFY;
process.on('exit', () => {
  process.env.LOCALAPPDATA = REAL_LOCAL;
  try { fs.rmSync(NO_MINIFY, { recursive: true, force: true }); } catch { /* going away anyway */ }
});

/** A view over a store that names `game` as the game, and a library holding `records`. */
function viewOver({ game = null, records = [] }: { game?: string | null; records?: LibRecord[] }) {
  const stored = { dotaGamePath: game, language: 'en' } as unknown as StoredSettings;
  const taken: string[] = [];
  const view = settingsViewFor({
    settings: { get: ((key: keyof StoredSettings) => stored[key]) as never, all: () => stored },
    library: { list: () => records },
    discordAuth: { isConfigured: () => true },
    validateGamePath: (p) => p === game && !!game,
    langFolder: () => 'russian',
    takeMigration: () => { taken.push('lang'); return { moved: 3 }; },
    takeSlotMigration: () => { taken.push('slots'); return { moved: 1 }; },
  });
  return { view, taken };
}

function fakeGame(t: TestContext) {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-view-'));
  t.after(() => fs.rmSync(game, { recursive: true, force: true }));
  fs.mkdirSync(path.join(game, 'dota_russian'));
  fs.mkdirSync(path.join(game, 'dota_koreana'));
  fs.writeFileSync(path.join(game, 'dota_koreana', 'pak30_dir.vpk'), 'left behind by a language change');
  return game;
}

test('the stored values come with the facts only the main process knows', (t) => {
  const game = fakeGame(t);
  const { view } = viewOver({ game });
  const out = view();
  assert.equal(out.dotaGamePath, game);
  assert.equal(out.dotaPathValid, true, 'the flag whose loss stopped every install');
  assert.equal(out.discordConfigured, true);
  assert.equal(out.minify.present, false);
  assert.equal(out.gameLang.folder, 'russian');
});

test('mods in a folder the game does not mount are named, so the screen can offer to move them', (t) => {
  const { view } = viewOver({ game: fakeGame(t) });
  assert.deepEqual(view().gameLang.stranded, [{ suffix: 'koreana', modFiles: 1 }]);
});

test('without a game the view still answers, with nothing to say about folders', () => {
  const { view } = viewOver({});
  const out = view();
  assert.equal(out.dotaPathValid, false);
  assert.deepEqual(out.gameLang.stranded, []);
  assert.equal(out.gameLang.mounted, null);
  assert.equal(out.gameLang.launchLang, null);
});

test('the news of a migration goes to the screen that asked for it, and a save does not swallow it', () => {
  const { view, taken } = viewOver({});
  const saved = view();
  assert.equal(saved.langMigration, null);
  assert.deepEqual(taken, [], 'a save read nothing');

  const opened = view({ consumeMigration: true });
  assert.deepEqual(opened.langMigration, { moved: 3 });
  assert.deepEqual(opened.slotMigration, { moved: 1 });
  assert.deepEqual(taken, ['lang', 'slots']);
});

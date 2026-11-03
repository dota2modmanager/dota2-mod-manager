// Steam's manifest for Dota, read before Play (src/steam-appstate.ts, issue #427).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { launchWarning, parseAppManifest, readAppState, updatePending } from '../src/steam-appstate.ts';

// the shape Steam writes, cut down from a real appmanifest_570.acf
const manifest = (flags: number) => `"AppState"
{
\t"appid"\t\t"570"
\t"name"\t\t"Dota 2"
\t"StateFlags"\t\t"${flags}"
\t"installdir"\t\t"dota 2 beta"
\t"BytesToDownload"\t\t"186544"
\t"BytesDownloaded"\t\t"1024"
}`;

test('the manifest gives its flags and download counts', () => {
  assert.deepEqual(parseAppManifest(manifest(4)), { flags: 4, toDownload: 186544, downloaded: 1024 });
});

test('a manifest with no StateFlags is not read as a state', () => {
  assert.equal(parseAppManifest('"AppState"\n{\n}'), null);
});

test('only a fully installed game with no update bits counts as ready', () => {
  assert.equal(updatePending({ flags: 4, toDownload: 0, downloaded: 0 }), false);
  for (const flags of [6, 4 | 256, 4 | 512, 4 | 1024, 1026, 0]) {
    assert.equal(updatePending({ flags, toDownload: 0, downloaded: 0 }), true, `StateFlags ${flags}`);
  }
});

test('the manifest is found three folders above the game folder', () => {
  const game = path.join('S', 'steamapps', 'common', 'dota 2 beta', 'game');
  let asked = '';
  const state = readAppState(game, (p) => { asked = p; return manifest(1030); });
  assert.equal(asked, path.resolve('S', 'steamapps', 'appmanifest_570.acf'));
  assert.equal(state && updatePending(state), true);
});

test('no game path, or no manifest there, is no answer rather than a guess', () => {
  assert.equal(readAppState(null), null);
  assert.equal(readAppState(path.join('nowhere', 'a', 'b', 'c'), () => { throw new Error('ENOENT'); }), null);
});

test('the launch warns only while an update is due', () => {
  const game = path.join('S', 'steamapps', 'common', 'dota 2 beta', 'game');
  assert.equal(launchWarning(game, () => manifest(4)), null);
  assert.match(launchWarning(game, () => manifest(6)) ?? '', /Steam/);
  assert.equal(launchWarning(game, () => { throw new Error('ENOENT'); }), null);
});

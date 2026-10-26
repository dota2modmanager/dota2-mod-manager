/**
 * The game for modkit: its folder (`--game`, else the app's settings, else where Steam put it) and
 * its pak01, read through the app's own VPK reader.
 */
import fs from 'node:fs';
import path from 'node:path';
import { appGamePath } from './lib.mjs';

/** A module of the app's own (src/), which Node runs with its types stripped. */
export const src = (file) => import(new URL(`../../src/${file}`, import.meta.url).href);

/** "<...>/dota 2 beta/game", or an error that says what to pass. */
export async function gameFolder(opts) {
  let game = typeof opts.game === 'string' ? opts.game : appGamePath();
  if (!game) {
    const { findDotaGamePath } = await src('steam.ts');
    game = await findDotaGamePath();
  }
  if (!game || !fs.existsSync(path.join(game, 'dota', 'pak01_dir.vpk'))) {
    throw new Error('Dota 2 not found: pass --game "<...>/steamapps/common/dota 2 beta/game"');
  }
  return game;
}

/** The game's pak01 as an index: paths(), has(path), read(path). */
export async function pak01(opts) {
  const game = await gameFolder(opts);
  const { sharedVpkIndex } = await src('vpk.ts');
  return { game, index: sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk')) };
}

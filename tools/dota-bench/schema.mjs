/**
 * An item table for the bench (--schema): the game reads scripts/items/items_game.txt only
 * through the folder the app's search-path patch registers (src/patcher.ts), never from the
 * language folder where the bench puts a mod. So a build that changes the table (an unusual
 * effect, another item's effect worn on the pick) is tried by putting the table where the app
 * deploys it, game/dota_mods/pak01_dir.vpk, for the run, and putting back what was there.
 *
 * It needs the patch in and signed, which is the app with safe mode off; the bench does not
 * patch the game itself.
 */
import fs from 'node:fs';
import path from 'node:path';

const TABLE = 'scripts/items/items_game.txt';

/**
 * The pak the table goes in: a VPK as given, or a text table packed as the one file the app's
 * deploy writes.
 */
export async function schemaPak(file) {
  const data = fs.readFileSync(file);
  if (data.readUInt32LE(0) === 0x55aa1234) return data;
  const { buildVpk, entryAt } = await import('../../src/vpk.ts');
  if (!/"items_game"/.test(data.subarray(0, 4096).toString('latin1'))) throw new Error(`bench: ${file} is neither a VPK nor an items_game.txt`);
  return buildVpk([entryAt(TABLE, data)]);
}

/**
 * The table into the game for the run. Answers how to put back what was there: the app's own
 * deployed table, or nothing.
 * @param heal the owner turned safe mode off (settings.schemaPatch) and where the app keeps its
 *   backups of the patched files: a patch a Dota update unsigned or outdated is applied again,
 *   as the app does on its next start (src/schema-service.ts); without it the bench refuses
 * @param {string} file
 * @param {string} game
 * @param {{ backupDir: string } | null} [heal]
 */
export async function placeSchema(file, game, heal = null) {
  const patcher = await import('../../src/patcher.ts');
  let st = patcher.state(game, patcher.FOLDER);
  const broken = !st.patched || st.outdated || (st.signable && !st.signed);
  if (broken && heal && st.patched) {
    patcher.apply({ gamePath: game, folder: patcher.FOLDER, backupDir: heal.backupDir });
    st = patcher.state(game, patcher.FOLDER);
  }
  if (!st.patched || (st.signable && !st.signed)) {
    throw new Error('bench: --schema needs the search-path patch in the game: turn safe mode off in the app once, then run the bench again');
  }
  const pak = await schemaPak(file);
  const dir = path.join(game, patcher.FOLDER);
  const dest = path.join(dir, 'pak01_dir.vpk');
  const keep = `${dest}.bench-kept`;
  fs.mkdirSync(dir, { recursive: true });
  // a kept one from a run that died is the app's: it goes back before this run takes its place
  if (fs.existsSync(keep)) fs.renameSync(keep, dest);
  const had = fs.existsSync(dest);
  if (had) fs.renameSync(dest, keep);
  fs.writeFileSync(dest, pak);
  return () => {
    fs.rmSync(dest, { force: true });
    if (had) fs.renameSync(keep, dest);
  };
}

/**
 * An item table for the bench (--schema): the game reads scripts/items/items_game.txt only
 * through the folder the app's search-path patch registers (crates/mm-core/src/game/patcher.rs), never from the
 * language folder where the bench puts a mod. So a build that changes the table (an unusual
 * effect, another item's effect worn on the pick) is tried by putting the table where the app
 * deploys it, game/dota_mods/pak01_dir.vpk, for the run, and putting back what was there.
 *
 * It needs the patch in and signed, which is the app with safe mode off; the bench does not
 * patch the game itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// the app's own code, through mm-cli (tools/dev/mm-cli.js)
const { mm, call, jsonFile, tmpDir } = createRequire(import.meta.url)('../../dev/mm-cli.js');
// the folder the app's search-path patch registers (FOLDER in crates/mm-core/src/game/patcher.rs)
const FOLDER = 'dota_mods';

const TABLE = 'scripts/items/items_game.txt';

/**
 * The pak the table goes in: a VPK as given, or a text table packed as the one file the app's
 * deploy writes.
 */
export async function schemaPak(file) {
  const data = fs.readFileSync(file);
  if (data.readUInt32LE(0) === 0x55aa1234) return data;
  if (!/"items_game"/.test(data.subarray(0, 4096).toString('latin1'))) throw new Error(`bench: ${file} is neither a VPK nor an items_game.txt`);
  // packed by the app's own writer, through mm-cli vpk-build
  const out = path.join(tmpDir(), 'schema_dir.vpk');
  mm('vpk-build', out, jsonFile([[TABLE, path.resolve(file)]]));
  return fs.readFileSync(out);
}

/** A rename that answers whether there was anything to rename. */
function moveIfThere(from, to) {
  try {
    fs.renameSync(from, to);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * The table into the game for the run. Answers how to put back what was there: the app's own
 * deployed table, or nothing.
 * @param heal the owner turned safe mode off (settings.schemaPatch) and where the app keeps its
 *   backups of the patched files: a patch a Dota update unsigned or outdated is applied again,
 *   as the app does on its next start (crates/mm-core/src/schema/schema_service.rs); without it the bench refuses
 * @param {string} file
 * @param {string} game
 * @param {{ backupDir: string } | null} [heal]
 */
export async function placeSchema(file, game, heal = null) {
  // the app's own patcher (crates/mm-core/src/game/patcher.rs), through mm-cli
  const step = (op) => {
    const [r] = call('patcher.script', game, heal?.backupDir ?? '', [[op, FOLDER]]);
    if (r.error) throw new Error(r.error);
    return r.ok;
  };
  let st = step('state');
  const broken = !st.patched || st.outdated || (st.signable && !st.signed);
  if (broken && heal && st.patched) {
    step('apply');
    st = step('state');
  }
  if (!st.patched || (st.signable && !st.signed)) {
    throw new Error('bench: --schema needs the search-path patch in the game: turn safe mode off in the app once, then run the bench again');
  }
  const pak = await schemaPak(file);
  const dir = path.join(game, FOLDER);
  const dest = path.join(dir, 'pak01_dir.vpk');
  const keep = `${dest}.bench-kept`;
  fs.mkdirSync(dir, { recursive: true });
  // Moved, not asked about first: the rename says whether the file was there, so nothing can come
  // or go between a check and the move. A kept one from a run that died is the app's: it goes
  // back before this run takes its place.
  moveIfThere(keep, dest);
  const had = moveIfThere(dest, keep);
  fs.writeFileSync(dest, pak, { flag: 'wx' });
  return () => {
    fs.rmSync(dest, { force: true });
    if (had) fs.renameSync(keep, dest);
  };
}

/* Whether the game's pak01 changed: a listing of its files' stats, which the app asks for before it
 * trusts anything it keeps of the game (the item table, the pictures, the 3D models).
 *
 * The game has 679 pak01 files, and a stat of each is 20 to 80 ms, seconds when the disk is busy.
 * The item builder's 3D preview asked on every slot shown, and the window froze for 3.5 s of
 * stats on a click (2026-11-10). An update rewrites pak01_dir.vpk, which indexes every other pak,
 * so while it stands as it was the others do too, and the listing made with it is kept.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The last listing of each kind, under the stat of pak01_dir.vpk it was made with. */
const listings = new Map<string, { head: string; value: string }>();

/**
 * Each of the game's pak01 files, as `describe` puts its stat, in name order.
 * @param kind  which listing: each `describe` keeps its own
 * @throws when pak01_dir.vpk or the folder cannot be read
 */
export function pakFiles(gamePath: string, kind: string, describe: (st: fs.Stats) => string): string {
  const dir = path.join(gamePath, 'dota');
  const head = describe(fs.statSync(path.join(dir, 'pak01_dir.vpk')));
  const key = `${kind}|${dir}`;
  const known = listings.get(key);
  if (known?.head === head) return known.value;
  const parts: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^pak01_(dir|\d{3})\.vpk$/i.test(f)) continue;
    parts.push(`${f}:${describe(fs.statSync(path.join(dir, f)))}`);
  }
  const value = parts.sort().join('|');
  listings.set(key, { head, value });
  return value;
}

/** Cheap "did the game update?" probe: size+mtime of the paks that carry the schema. */
export function gameSchemaStamp(gamePath: string): string {
  return pakFiles(gamePath, 'stamp', (st) => `${st.size}:${Math.floor(st.mtimeMs)}`);
}

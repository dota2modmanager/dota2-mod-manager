// Packing a folder of loose game files into a mod: where the content starts under the folder an
// author points at, and one self-contained VPK built from everything under it. Part of the VPK
// code src/vpk.ts gathers; the archive itself is written by src/vpk-write.ts.
import fs from 'node:fs';
import path from 'node:path';
import { t } from './i18n.ts';
import type { VpkEntry } from './vpk-read.ts';
import { buildVpk, entryAt } from './vpk-write.ts';

// The folders the game itself mounts. A mod author's working copy is a tree of these, and
// finding which directory they sit directly under is what tells us where the archive's root
// is - get that wrong and the mod installs, mounts, and changes nothing, because every path
// inside it is off by a folder.
const GAME_ROOTS = new Set([
  'models', 'materials', 'particles', 'panorama', 'sounds', 'soundevents',
  'scripts', 'resource', 'maps', 'vscripts', 'shaders', 'expressions',
]);

// Not content, and not something an author means to ship.
const JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store|\.git|\.gitignore|\.svn|__macosx)$/i;

/**
 * Where the mod's content actually starts under `dir`.
 *
 * An author points at "MyMod", but the tree underneath may be MyMod/models/..., or the
 * game-shaped MyMod/game/dota_russian/models/..., or a single wrapper folder left by
 * unzipping. Whatever it is, the archive root is the directory that holds the game's own
 * folders - and everything beside them comes too: measured over 84 installed mods, 35 carry
 * a top folder of the author's own (dota2pornfx/, amir4an/, models123/) next to the
 * canonical ones, and three ship a readme.
 *
 * @returns absolute path, or null if nothing game-shaped is under there
 */
export function findContentRoot(dir: string, depth = 0): string | null {
  if (depth > 6) return null;
  let names: fs.Dirent[];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const dirs = names.filter((e) => e.isDirectory() && !JUNK.test(e.name));
  if (dirs.some((e) => GAME_ROOTS.has(e.name.toLowerCase()))) return dir;
  // no game folder here: follow the wrappers down, and only while they are unambiguous
  for (const e of dirs) {
    const hit = findContentRoot(path.join(dir, e.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

// One buffer holds the whole archive while it is being built, so this is where a folder
// stops being something we can pack in one piece. The largest real mod measured is 46 MB;
// a gigabyte is twenty times that and still far below what a Buffer can hold.
const MAX_FOLDER_BYTES = 1024 * 1024 * 1024;

/**
 * Pack a folder of loose game files into a single self-contained VPK - the other half of
 * importing, for the author who has the files but not the archive.
 * @param root the content root (see findContentRoot)
 */
export function packFolder(root: string): Buffer {
  const entries: VpkEntry[] = [];
  let total = 0;
  const walk = (dir: string, prefix: string): void => {
    let names: fs.Dirent[];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      if (JUNK.test(e.name)) continue;
      // a symlink is somebody else's file, and following one can walk in a circle
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(full, rel); continue; }
      if (!e.isFile()) continue;
      let data: Buffer;
      try { data = fs.readFileSync(full); } catch { continue; }
      total += data.length;
      if (total > MAX_FOLDER_BYTES) throw new Error(t('Папка слишком большая, чтобы собрать её в один VPK'));
      // entryAt lower-cases the path: the game looks files up that way, and so does every reader here
      entries.push(entryAt(rel, data));
    }
  };
  walk(root, '');
  if (!entries.length) throw new Error(t('В папке нет файлов'));
  return buildVpk(entries);
}

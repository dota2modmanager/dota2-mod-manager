// Making and moving the dota_<lang> folders (src/gamelang.ts has the rule): whether a voice pack is
// on disk, a folder created the way Valve ships one when the game would mount it empty, and the
// app's mods carried from one folder to another when the audio language changes.
import fs from 'node:fs';
import path from 'node:path';
import { isMinifyFile, isMinifyPak } from './minify.ts';

// what Valve puts in every official language folder; mirrored when we have to create one
const gameinfoStub = (suffix: string) => `"GameInfo"
{
	LayeredOnMod	dota

	FileSystem
	{
		SearchPaths
		{
			Game				dota_${suffix}
			Game				dota
			Game				core

			Mod					dota_${suffix}
			Mod					dota

			AddonRoot			dota_addons

			// Note: addon content is included in publiccontent by default.
			PublicContent		core
		}
	}
}
`;

/** Is Valve's voice pack for this language actually on disk? If not, voices stay English. */
export function voiceInstalled(gamePath: string, suffix: string): boolean {
  try {
    return fs.readdirSync(path.join(gamePath, `dota_${suffix}`)).some((f) => /^pak01_/i.test(f));
  } catch {
    return false;
  }
}

/**
 * Make sure the mod folder exists. English is the one language Valve ships no folder for
 * (English voice lives in dota/pak01), so for it we create the layer ourselves, shaped
 * exactly like Valve's own — never touching a gameinfo.gi that is already there.
 */
export function ensureLangFolder(gamePath: string, suffix: string): string {
  const dir = path.join(gamePath, `dota_${suffix}`);
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, 'gameinfo.gi');
  /* Only into a folder we are creating. A folder that was already here belongs to whoever
   * made it - another mod manager, or Valve - and it plainly works without anything from us,
   * so adding a file to it would be littering in somebody else's room.
   *
   * 'wx' creates the file or fails because one is there, in a single call. Looking first and
   * writing second left a gap in which another program's gameinfo.gi was replaced by ours. */
  if (!existed) {
    try {
      fs.writeFileSync(gi, gameinfoStub(suffix), { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  return dir;
}

/**
 * Move installed mod files from one language folder to another, which is what has to happen
 * when the game's audio language changes: the folder the engine mounts changes with it, and
 * mods left behind are invisible with no error anywhere.
 *
 * Three kinds of file are left where they are. Valve's own - `pak01_*` voice paks and the
 * `gameinfo.gi` that defines the layer - belong to the folder rather than to anybody's mods.
 * Another program's work is not ours to relocate, whatever folder it is sitting in. And a name
 * already taken in the destination is not overwritten, because the file there is somebody's
 * current mod and this one is a leftover.
 *
 * @returns how many files were actually moved
 */
export function moveLangFolder(gamePath: string | null | undefined, fromSuffix: string | null | undefined, toSuffix: string | null | undefined): number {
  if (!gamePath || !fromSuffix || !toSuffix || fromSuffix === toSuffix) return 0;
  const oldDir = path.join(gamePath, `dota_${fromSuffix}`);
  let moved = 0;
  try {
    if (!fs.existsSync(oldDir)) return 0;
    const newDir = ensureLangFolder(gamePath, toSuffix);
    for (const f of fs.readdirSync(oldDir)) {
      if (/^pak01_/i.test(f) || f.toLowerCase() === 'gameinfo.gi') continue;
      if (isMinifyFile(f.toLowerCase()) || isMinifyPak(path.join(oldDir, f))) continue;
      const dst = path.join(newDir, f);
      if (fs.existsSync(dst)) continue;
      fs.renameSync(path.join(oldDir, f), dst);
      moved++;
    }
    // a folder we no longer use and that holds nothing else goes away
    if (!fs.readdirSync(oldDir).length) fs.rmdirSync(oldDir);
  } catch (err) {
    console.error('lang folder migration failed:', err);
  }
  return moved;
}

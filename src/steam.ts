// Finding Steam, and then finding Dota inside it.
//
// Only the first step differs by platform. Windows keeps the answer in the registry; Linux
// keeps it in a folder whose name depends on how Steam was installed, and there are four
// plausible ones. Everything after that is Steam's own layout rather than the platform's:
// libraryfolders.vdf lists the other drives, the game sits under steamapps/common, and both
// read the same on either system.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WINDOWS = process.platform === 'win32';

function regQuery(hive: string, key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', `${hive}\\${key}`, '/v', value], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const m = stdout.match(/REG_SZ\s+(.+)/);
      resolve(m ? m[1].trim() : null);
    });
  });
}

/* parseLibraryFolders and steamappsDir are exported for the tests and used nowhere else.
 * Both read files Valve writes, in formats Valve changes without telling anybody, and a wrong
 * answer from either sends the app looking for the game on the wrong drive - which is the kind
 * of thing that is hard to notice and easy to pin down with a fixture. */
export function parseLibraryFolders(vdfText: string): string[] {
  // libraryfolders.vdf: "path" "C:\\..." entries
  const paths: string[] = [];
  const re = /"path"\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(vdfText)) !== null) {
    paths.push(m[1].replace(/\\\\/g, '\\'));
  }
  return paths;
}

/* Where Steam lives on Linux, in the order worth trying.
 *
 * ~/.steam/steam is a symlink Steam maintains for exactly this question and it survives the
 * moves Valve has made over the years. ~/.local/share/Steam is where the files actually are on
 * a current install, and XDG_DATA_HOME moves that for the people who set it. The flatpak build
 * sees none of the above: it has its own home under ~/.var/app.
 */
function linuxSteamRoots(): string[] {
  const home = os.homedir();
  const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.steam', 'root'),
    path.join(xdg, 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam'),
  ];
}

/* Steam spelled it SteamApps for years and steamapps after that. Windows does not care and
 * Linux does, so the folder that is actually on disk decides.
 */
export function steamappsDir(lib: string): string {
  for (const name of ['steamapps', 'SteamApps']) {
    const dir = path.join(lib, name);
    if (fs.existsSync(dir)) return dir;
  }
  return path.join(lib, 'steamapps');
}

async function findSteamRoot(): Promise<string | null> {
  const candidates: (string | null)[] = WINDOWS
    ? [
        await regQuery('HKCU', 'SOFTWARE\\Valve\\Steam', 'SteamPath'),
        await regQuery('HKLM', 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
        await regQuery('HKLM', 'SOFTWARE\\Valve\\Steam', 'InstallPath'),
      ]
    : linuxSteamRoots();
  for (let c of candidates) {
    if (!c) continue;
    // The registry answers with either slash; a POSIX path must be left exactly as it is.
    if (WINDOWS) c = c.replace(/\//g, '\\');
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/* Libraries to look through when Steam itself did not tell us, in the places people put them.
 * On Windows that is every drive letter; on Linux the roots are the same handful as above,
 * plus the one folder a second library usually ends up in.
 */
function fallbackLibraries(): string[] {
  if (!WINDOWS) return [...linuxSteamRoots(), path.join(os.homedir(), 'Games', 'SteamLibrary')];
  const libs = [];
  for (const drive of 'CDEFGH') {
    libs.push(
      `${drive}:\\Program Files (x86)\\Steam`,
      `${drive}:\\Program Files\\Steam`,
      `${drive}:\\Steam`,
      `${drive}:\\Games\\Steam`,
      `${drive}:\\SteamLibrary`
    );
  }
  return libs;
}

export async function findDotaGamePath(): Promise<string | null> {
  const steamRoot = await findSteamRoot();
  const libs: string[] = [];
  if (steamRoot) {
    libs.push(steamRoot);
    const vdf = path.join(steamappsDir(steamRoot), 'libraryfolders.vdf');
    if (fs.existsSync(vdf)) {
      try {
        libs.push(...parseLibraryFolders(fs.readFileSync(vdf, 'utf-8')));
      } catch { /* ignore parse errors, fall back to scan */ }
    }
  }
  libs.push(...fallbackLibraries());

  const seen = new Set<string>();
  for (const lib of libs) {
    if (!lib || seen.has(lib.toLowerCase())) continue;
    seen.add(lib.toLowerCase());
    const game = path.join(steamappsDir(lib), 'common', 'dota 2 beta', 'game');
    if (validateGamePath(game)) return game; // the leftovers of a moved library are not a hit
  }
  return null;
}

/* A folder called "dota" is not a Dota install.
 *
 * This used to check for the subfolder and nothing else, and that is exactly how a user lost
 * 43 mods (2026-08-14). He had moved his library from C to F; Steam left the empty tree behind
 * on C, as it does; the app looked at "...\dota 2 beta\game\dota", said yes, and spent weeks
 * installing into a corpse. The library listed everything, the game showed nothing, and the
 * app's own log said "pak01_dir.vpk not found" a thousand times without anyone acting on it.
 *
 * So the test is Valve's own: the base content pak, or the executable. Either one is enough,
 * and the leftovers of a move have neither. The executable has a different name and a
 * different folder on Linux, and src/patcher.js already knows both.
 *
 * Two markers rather than one because a single file can be absent from a real install for a
 * moment - mid-download, or while Steam verifies. Note which pak this is: game\dota\pak01_dir
 * is the game's own content and is always there. The pak01 files in game\dota_<language> are
 * the voice pack, which plenty of people never download, and testing for those would call a
 * working install broken.
 */
export function validateGamePath(p: string | null | undefined): boolean {
  if (!p) return false;
  try {
    return fs.existsSync(path.join(p, 'dota', 'pak01_dir.vpk'))
      || fs.existsSync(path.join(p, 'bin', 'win64', 'dota2.exe'))
      || fs.existsSync(path.join(p, 'bin', 'linuxsteamrt64', 'dota2'));
  } catch {
    return false;
  }
}

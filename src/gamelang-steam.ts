// What Steam says about the game's language (src/gamelang.ts has the rule): the -language in the
// launch options of whoever is signed in, and the language set in the game's properties. Read
// out of Steam's own files beside the game, or where Steam installs by default.
import fs from 'node:fs';
import path from 'node:path';

/** One "key" "value" pair out of a Valve KeyValues text, the first one that matches. */
export const readKey = (text: string, key: string): string | null => {
  const m = text.match(new RegExp(`"${key}"\\s*"([^"]+)"`, 'i'));
  return m ? m[1].trim().toLowerCase() : null;
};

/* A `-language X` in Steam's launch options, which beats everything the game wrote itself.
 *
 * While it is set, both language settings are locked to it and the mount follows it - which is
 * how Minify gets dota_dutch mounted. So a machine can be pointed at a folder that boot.vcfg
 * knows nothing about, and reading only boot.vcfg would have this app confidently name the
 * wrong folder.
 *
 * Steam keeps launch options per account, so the answer belongs to whoever is logged in: that
 * account having none means there is no override, and another account's value is not ours to
 * borrow. Which account that is comes from loginusers.vdf - MostRecent where the file has it,
 * newest Timestamp where it does not (this Steam build writes only the latter).
 */
function currentSteamUser(root: string): string | null {
  let text: string;
  try { text = fs.readFileSync(path.join(root, 'config', 'loginusers.vdf'), 'utf-8'); } catch { return null; }
  let best: { id: string; rank: number } | null = null;
  for (const m of text.matchAll(/"(\d{17})"\s*\{([\s\S]*?)\n\t\}/g)) {
    const mostRecent = (m[2].match(/"MostRecent"\s*"(\d)"/) || [])[1];
    const stamp = Number((m[2].match(/"Timestamp"\s*"(\d+)"/) || [])[1] || 0);
    const rank = mostRecent === '1' ? Infinity : stamp;
    if (!best || rank > best.rank) best = { id: m[1], rank };
  }
  // userdata folders are the 32-bit account id
  try { return best ? String(BigInt(best.id) - 76561197960265728n) : null; } catch { return null; }
}

/* Dota's launch options as Steam stores them, with the escapes of the format undone.
 *
 * `[^"]*` was good enough while launch options were a handful of flags, and stopped being good
 * enough the moment another program put a quoted path in one. Minify v1.14rc7 prepends
 *
 *   cmd /c "<...>\Dota2-Minify.exe" prelaunch && %command%
 *
 * so it can patch before the game starts, and writes the file back with python-vdf, which
 * escapes the quotes it just introduced. Reading up to the first quote character then captured
 * `cmd /c \` and discarded everything after it - including the `-language` that decides which
 * folder this app installs into. The app concluded there was no launch option at all, went back
 * to the folder named by the voice setting, and put mods where the game does not look. That is
 * the whole 2.6.1 failure walking back in, for everybody running the new Minify.
 *
 * A backslash escapes whatever follows it, so a quote ends the value only when it is not itself
 * escaped.
 * @returns the value, or null when the file or the key is not there
 */
function readLaunchOptions(file: string): string | null {
  let text: string;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { return null; }
  const app = text.match(/"570"\s*\{[\s\S]{0,4000}?"LaunchOptions"\s*"((?:\\.|[^"\\])*)"/);
  if (!app) return null;
  const escapes: Record<string, string> = { n: '\n', t: '\t', v: '\v', b: '\b', r: '\r', f: '\f' };
  return app[1].replace(/\\(.)/g, (_, c) => (c in escapes ? escapes[c] : c));
}

/* Ask the launch options one question, on behalf of whoever is logged in.
 *
 * Steam keeps them per account, so the answer belongs to that account: having none means there
 * is no override, and another account's value is not ours to borrow. Where nobody can be
 * identified, an answer every account with one agrees on is safe to use and a disagreement is
 * not an answer.
 * @param pick what to take out of one account's options
 */
function fromLaunchOptions(gamePath: string | null | undefined, pick: (raw: string | null) => string | null): string | null {
  const roots: string[] = [];
  if (gamePath) {
    // <lib>/steamapps/common/dota 2 beta/game -> <lib>, which is the Steam root for a default install
    roots.push(path.resolve(gamePath, '..', '..', '..', '..'));
  }
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
      if (base) roots.push(path.join(base, 'Steam'));
    }
  }
  for (const root of roots) {
    const userdata = path.join(root, 'userdata');
    let ids: string[] = [];
    try { ids = fs.readdirSync(userdata).filter((d) => /^\d+$/.test(d)); } catch { continue; }
    if (!ids.length) continue;

    const valueOf = (id: string) => pick(readLaunchOptions(path.join(userdata, id, 'config', 'localconfig.vdf')));
    const current = currentSteamUser(root);
    if (current && ids.includes(current)) {
      const own = valueOf(current);
      return own || null; // '' means launch options exist and say nothing about this question
    }
    const values = new Set<string>();
    for (const id of ids) {
      const v = valueOf(id);
      if (v) values.add(v);
    }
    return values.size === 1 ? [...values][0] : null;
  }
  return null;
}

/** The `-language X` Steam will start the game with, lowercased, or null. */
export function launchLanguage(gamePath: string | null | undefined): string | null {
  return fromLaunchOptions(gamePath, (raw) => {
    if (raw === null) return null;
    const lang = raw.match(/-language\s+([A-Za-z]+)/);
    return lang ? lang[1].toLowerCase() : '';
  });
}

/** Everything Steam will start the game with, verbatim, or null. */
export function launchOptions(gamePath: string | null | undefined): string | null {
  return fromLaunchOptions(gamePath, (raw) => raw);
}

/** Language Steam has the game mounted as — the fallback before Dota has ever booted. */
export function steamLanguage(gamePath: string | null | undefined): string | null {
  if (!gamePath) return null;
  try {
    // <lib>/steamapps/common/dota 2 beta/game -> <lib>/steamapps/appmanifest_570.acf
    const acf = path.resolve(gamePath, '..', '..', '..', 'appmanifest_570.acf');
    const text = fs.readFileSync(acf, 'utf-8');
    for (const block of ['MountedConfig', 'UserConfig']) {
      const m = text.match(new RegExp(`"${block}"\\s*\\{([^}]*)\\}`, 'i'));
      const lang = m && readKey(m[1], 'language');
      if (lang) return lang;
    }
  } catch { /* not a Steam layout, or no manifest */ }
  return null;
}

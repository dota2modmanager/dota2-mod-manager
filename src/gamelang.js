/* Which dota_<lang> folder the game actually mounts.
 *
 * This comment is the rule, not a summary of one. It has been re-derived from screenshots and
 * from other people's code more than once and come out wrong every time, so it is written
 * down here and in the vault (VPK Format, "единый источник правды"), and changed only by
 * measurement.
 *
 * FOUR voice languages exist: English, Russian, Chinese, Korean. THREE of them have a folder
 * that mounts: dota_russian, dota_schinese, dota_koreana. There is no English folder at all -
 * English is what the base game already carries, so it is what plays whenever the chosen
 * voice pack is not on disk.
 *
 * Dota keeps both settings in game/dota/cfg/boot.vcfg:
 *
 *   "boot" { "UILanguage" "russian"  "AudioLanguage" "russian" }
 *
 * and builds the Game_Language search path (dota_*LANGUAGE* in gameinfo.gi) out of the AUDIO
 * one. Since the 2026-07-24 update that value has to be a real language: a made-up folder
 * like dota_123 is mounted by nothing.
 *
 * Steam decides which voice pack is on disk, from the game's language in its properties, and
 * it keeps exactly one: choosing Korean deletes the Russian pack and downloads the Korean.
 * English is always there and downloads nothing.
 *
 * WHICH IS THE WHOLE TRICK THIS APP IS BUILT ON. Set the audio language to one of the three
 * that have a folder, and put mods there. Somebody whose Steam language is English has no
 * Russian voice pack, so dota_russian mounts as an empty carrier, their mods load out of it,
 * and they keep hearing English because that is what the base game plays. No launch
 * parameters, no folder invented by hand, no VPK to fix the text back, and the player is
 * still free to set the text language to anything they like.
 *
 * The other route, for contrast (it is what Minify does, see src/minify.js): put
 * `-language dutch` in Steam's launch options. Text becomes Dutch, voices fall back to
 * English, dota_dutch mounts - but the folder does not exist until somebody creates it with a
 * gameinfo.gi of its own, both language settings are locked while the parameter is there, so
 * getting English text back needs a VPK carrying the English localization, and the app has to
 * write into Steam's own config to set it up. Valve have already stopped mounting invented
 * folders; the languages with no voice pack of their own are the ones that could go the same
 * way, while these three cannot - the game has to mount them to play their voices.
 */
const fs = require('fs');
const path = require('path');
const { isMinifyFile, isMinifyPak } = require('./minify');

/* Languages Dota records VOICE in - four of them, and that is the list that matters here.
 *
 * The engine substitutes the audio language into its Game_Language search path, so the folder
 * a mod has to live in is named by this setting and by nothing else. Text is a different list
 * of twenty-nine languages living in dota/pak01, and it has no bearing on any of this; reading
 * the wrong one of the two is how a mod ends up in a folder nobody mounts.
 */
const VOICE_LANGUAGES = ['english', 'koreana', 'russian', 'schinese'];

/* Three of those four get a folder on disk.
 *
 * English speech ships inside dota/pak01 with the base game, so Valve makes no dota_english,
 * and its own gameinfo.gi mounts the language path only "if running a specific language",
 * which English is not. A dota_english built by hand, correct gameinfo.gi and all, filled with
 * mods, is never read. Tested 2026-08-10 rather than assumed, twice.
 */
const MOD_FOLDERS = ['koreana', 'russian', 'schinese'];

/** Borrowed by English, and by anything unrecognised. */
const FALLBACK_FOLDER = 'russian';

/* Every language Dota will accept for that setting, which is a longer list than the four it
 * records voice in - text for all of them ships inside dota/pak01.
 *
 * Only used to answer "would the game mount a folder by this name at all". Since the
 * 2026-07-24 update the setting is where the mount path comes from, and it takes a language
 * rather than any string, so a folder named after something that is not on this list is never
 * read - which is the whole reason Minify moved off its own "minify" locale (see
 * src/minify.js). Cross-checked against Minify's own enumeration of the same set.
 */
const DOTA_LANGUAGES = [
  'brazilian', 'bulgarian', 'czech', 'danish', 'dutch', 'english', 'finnish', 'french',
  'german', 'greek', 'hungarian', 'italian', 'japanese', 'koreana', 'latam', 'norwegian',
  'polish', 'portuguese', 'romanian', 'russian', 'schinese', 'spanish', 'swedish', 'tchinese',
  'thai', 'turkish', 'ukrainian', 'vietnamese',
];

/**
 * The folder the game is going to mount, which is where mods have to go.
 *
 * A `-language X` in Steam's launch options wins outright: it locks both language settings and
 * the engine builds its content path from it, so a mod anywhere else is invisible no matter
 * what this app writes into boot.vcfg. Fighting that was a fight this app lost every launch -
 * it set the voice language back to Russian on every start while the parameter kept the game
 * reading dota_dutch, and the user got a folder nobody reads.
 *
 * So it follows instead. The parameter has to name a language Dota knows, because that is the
 * only kind of folder the engine mounts; anything else falls back to the voice language, which
 * is the ordinary path and the one this app sets itself.
 *
 * @param {string|null} launched  a `-language` value, if one is set
 * @param {string|null} audio     the voice language from the game's own settings
 * @returns {{ suffix: string, followed: boolean }} the folder, and whether a parameter chose it
 */
function modFolderFor(launched, audio) {
  const forced = launched ? String(launched).toLowerCase() : null;
  if (forced && DOTA_LANGUAGES.includes(forced)) return { suffix: forced, followed: true };
  return { suffix: folderFor(audio), followed: false };
}

/**
 * Where mods have to live for a given audio language.
 *
 * English has no folder of its own, so it borrows the Russian one. The folder mounts whether
 * or not Valve's voice pack was ever downloaded, because Steam decides what is on disk and
 * Dota decides what is mounted, and they are separate. So an English speaker gets a mounted
 * dota_russian holding nothing but mods, and keeps hearing the English speech out of
 * dota/pak01 without noticing anything happened.
 */
function folderFor(audio) {
  return MOD_FOLDERS.includes(audio) ? audio : FALLBACK_FOLDER;
}

// what Valve puts in every official language folder; mirrored when we have to create one
const gameinfoStub = (suffix) => `"GameInfo"
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

const readKey = (text, key) => {
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
function currentSteamUser(root) {
  let text = null;
  try { text = fs.readFileSync(path.join(root, 'config', 'loginusers.vdf'), 'utf-8'); } catch { return null; }
  let best = null;
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
 * @returns {string|null} the value, or null when the file or the key is not there
 */
function readLaunchOptions(file) {
  let text = null;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { return null; }
  const app = text.match(/"570"\s*\{[\s\S]{0,4000}?"LaunchOptions"\s*"((?:\\.|[^"\\])*)"/);
  if (!app) return null;
  const escapes = { n: '\n', t: '\t', v: '\v', b: '\b', r: '\r', f: '\f' };
  return app[1].replace(/\\(.)/g, (_, c) => (c in escapes ? escapes[c] : c));
}

/* Ask the launch options one question, on behalf of whoever is logged in.
 *
 * Steam keeps them per account, so the answer belongs to that account: having none means there
 * is no override, and another account's value is not ours to borrow. Where nobody can be
 * identified, an answer every account with one agrees on is safe to use and a disagreement is
 * not an answer.
 * @param {(raw: string|null) => string|null} pick what to take out of one account's options
 */
function fromLaunchOptions(gamePath, pick) {
  const roots = [];
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
    let ids = [];
    try { ids = fs.readdirSync(userdata).filter((d) => /^\d+$/.test(d)); } catch { continue; }
    if (!ids.length) continue;

    const valueOf = (id) => pick(readLaunchOptions(path.join(userdata, id, 'config', 'localconfig.vdf')));
    const current = currentSteamUser(root);
    if (current && ids.includes(current)) {
      const own = valueOf(current);
      return own || null; // '' means launch options exist and say nothing about this question
    }
    const values = new Set();
    for (const id of ids) {
      const v = valueOf(id);
      if (v) values.add(v);
    }
    return values.size === 1 ? [...values][0] : null;
  }
  return null;
}

/** The `-language X` Steam will start the game with, lowercased, or null. */
function launchLanguage(gamePath) {
  return fromLaunchOptions(gamePath, (raw) => {
    if (raw === null) return null;
    const lang = raw.match(/-language\s+([A-Za-z]+)/);
    return lang ? lang[1].toLowerCase() : '';
  });
}

/** Everything Steam will start the game with, verbatim, or null. */
function launchOptions(gamePath) {
  return fromLaunchOptions(gamePath, (raw) => raw);
}

/** UI + audio language the game wrote at its last boot, or null if it never ran. */
function bootLanguages(gamePath) {
  if (!gamePath) return null;
  try {
    const file = path.join(gamePath, 'dota', 'cfg', 'boot.vcfg');
    const text = fs.readFileSync(file, 'utf-8');
    const audio = readKey(text, 'AudioLanguage');
    const ui = readKey(text, 'UILanguage');
    if (!audio && !ui) return null;
    return { ui, audio: audio || ui };
  } catch {
    return null;
  }
}

/** Language Steam has the game mounted as — the fallback before Dota has ever booted. */
function steamLanguage(gamePath) {
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

/** Every dota_* folder on disk, with what is inside each. */
function langFolders(gamePath) {
  if (!gamePath) return [];
  const out = [];
  let names = [];
  try { names = fs.readdirSync(gamePath, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  for (const name of names) {
    const m = name.match(/^dota_(.+)$/i);
    if (!m) continue;
    const suffix = m[1].toLowerCase();
    if (['addons', 'lv', 'core', 'mods'].includes(suffix)) continue; // not language layers; dota_mods is ours
    let files = [];
    try { files = fs.readdirSync(path.join(gamePath, name)); } catch { /* unreadable */ }
    out.push({
      suffix,
      official: MOD_FOLDERS.includes(suffix),
      // Valve's own voice paks vs anything we or another tool put there
      valveContent: files.some((f) => /^pak01_/i.test(f)),
      modFiles: files.filter((f) => /^pak\d+_dir\.vpk(\.off|\.moff)?$/i.test(f) && !/^pak01_/i.test(f)).length,
    });
  }
  return out;
}

/**
 * The folder suffix the game will mount, and where that answer came from.
 * `boot` (the game's own setting) wins over `steam` (what the depot is set to).
 */
/* `suffix` is the audio language among the four Dota records voice in; `audio` is whatever
 * the setting actually says, which is not always one of them. Another mod manager can put a
 * language there that Valve ships no voice for - Minify sets Dutch, so the engine mounts
 * dota_dutch and reads its mods out of it - and the folder Dota mounts follows that value
 * whether or not we recognise it. Anything asking "whose mods are live" needs the raw one.
 */
function detectLangSuffix(gamePath) {
  const boot = bootLanguages(gamePath);
  const steam = steamLanguage(gamePath);
  // A launch option overrides and locks both settings, so it decides the folder no matter
  // what the game last wrote for itself.
  const launched = launchLanguage(gamePath);
  const audio = launched || boot?.audio || steam || null;
  if (launched) {
    return {
      suffix: VOICE_LANGUAGES.includes(launched) ? launched : null,
      source: 'launch',
      uiLanguage: boot?.ui || null,
      audio,
    };
  }
  if (boot?.audio && VOICE_LANGUAGES.includes(boot.audio)) {
    return { suffix: boot.audio, source: 'boot', uiLanguage: boot.ui || null, audio };
  }
  if (steam && VOICE_LANGUAGES.includes(steam)) {
    return { suffix: steam, source: 'steam', uiLanguage: boot?.ui || null, audio };
  }
  return { suffix: null, source: null, uiLanguage: boot?.ui || null, audio };
}

/**
 * Set the game's language settings. Dota reads boot.vcfg at startup, so this has to happen
 * while the game is closed. Existing keys are patched in place and anything else in the file
 * is left alone; a missing file gets Valve's own shape.
 *
 * Either setting may be left out, and the app leaves the text one out always: which language
 * somebody reads the game in is their business, decided long before this app arrived. Only
 * the audio language is ours to set, because it is what names the folder the engine mounts
 * and therefore where a mod has to live.
 * @param {string} gamePath
 * @param {{ ui?: string, audio?: string }} langs  a setting left out is left as it is
 */
function writeBootLanguages(gamePath, { ui, audio }) {
  const file = path.join(gamePath, 'dota', 'cfg', 'boot.vcfg');
  let text = null;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { /* first write */ }
  const pairs = [['UILanguage', ui], ['AudioLanguage', audio]].filter(([, v]) => v);
  if (!text || !/"boot"/i.test(text)) {
    text = `"boot"\n{\n${pairs.map(([k, v]) => `\t"${k}"\t\t"${v}"\n`).join('')}}\n`;
  } else {
    for (const [key, value] of pairs) {
      const re = new RegExp(`("${key}"\\s*")[^"]*(")`, 'i');
      if (re.test(text)) text = text.replace(re, `$1${value}$2`);
      else text = text.replace(/\}\s*$/, `\t"${key}"\t\t"${value}"\n}\n`);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { ui, audio };
}

/** Is Valve's voice pack for this language actually on disk? If not, voices stay English. */
function voiceInstalled(gamePath, suffix) {
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
function ensureLangFolder(gamePath, suffix) {
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
      if (err.code !== 'EEXIST') throw err;
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
 * @returns {number} how many files were actually moved
 */
function moveLangFolder(gamePath, fromSuffix, toSuffix) {
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

module.exports = {
  VOICE_LANGUAGES,
  DOTA_LANGUAGES,
  modFolderFor,
  launchLanguage,
  launchOptions,
  MOD_FOLDERS,
  FALLBACK_FOLDER,
  folderFor,
  bootLanguages,
  steamLanguage,
  langFolders,
  detectLangSuffix,
  writeBootLanguages,
  voiceInstalled,
  ensureLangFolder,
  moveLangFolder,
};

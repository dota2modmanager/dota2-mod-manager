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
 * and builds the language search path (dota_*LANGUAGE* in gameinfo.gi) out of the AUDIO
 * one; build 6946 (2026-10-07) renamed its key from Game_Language to Game_AudioLanguage, which
 * now says so in the file itself. Since the 2026-07-24 update that value has to be a real language: a made-up folder
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
 * The other route, for contrast (it is what Minify does, see src/minify.ts): put
 * `-language dutch` in Steam's launch options. Text becomes Dutch, voices fall back to
 * English, dota_dutch mounts - but the folder does not exist until somebody creates it with a
 * gameinfo.gi of its own, both language settings are locked while the parameter is there, so
 * getting English text back needs a VPK carrying the English localization, and the app has to
 * write into Steam's own config to set it up. Valve have already stopped mounting invented
 * folders; the languages with no voice pack of their own are the ones that could go the same
 * way, while these three cannot - the game has to mount them to play their voices.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchLanguage, readKey, steamLanguage } from './gamelang-steam.ts';

/** One dota_* folder on disk and what is in it; see langFolders. */
export interface LangFolder {
  suffix: string;
  /** one of the three folders Valve ships */
  official: boolean;
  /** holds Valve's own voice paks */
  valveContent: boolean;
  /** pak files that are not Valve's */
  modFiles: number;
}

/** The folder the game will mount, and where that answer came from; see detectLangSuffix. */
export interface LangDetection {
  suffix: string | null; source: 'launch' | 'boot' | 'steam' | null; uiLanguage: string | null; audio: string | null;
}

/* Languages Dota records VOICE in - four of them, and that is the list that matters here.
 *
 * The engine substitutes the audio language into its Game_AudioLanguage search path, so the folder
 * a mod has to live in is named by this setting and by nothing else. Text is a different list
 * of twenty-nine languages living in dota/pak01, and it has no bearing on any of this; reading
 * the wrong one of the two is how a mod ends up in a folder nobody mounts.
 */
export const VOICE_LANGUAGES: readonly string[] = ['english', 'koreana', 'russian', 'schinese'];

/* Three of those four get a folder on disk.
 *
 * English speech ships inside dota/pak01 with the base game, so Valve makes no dota_english,
 * and its own gameinfo.gi mounts the language path only "if running a specific language",
 * which English is not. A dota_english built by hand, correct gameinfo.gi and all, filled with
 * mods, is never read. Tested 2026-08-10 rather than assumed, twice.
 */
export const MOD_FOLDERS: readonly string[] = ['koreana', 'russian', 'schinese'];

/** Borrowed by English, and by anything unrecognised. */
export const FALLBACK_FOLDER = 'russian';

/* Every language Dota will accept for that setting, which is a longer list than the four it
 * records voice in - text for all of them ships inside dota/pak01.
 *
 * Only used to answer "would the game mount a folder by this name at all". Since the
 * 2026-07-24 update the setting is where the mount path comes from, and it takes a language
 * rather than any string, so a folder named after something that is not on this list is never
 * read - which is the whole reason Minify moved off its own "minify" locale (see
 * src/minify.ts). Cross-checked against Minify's own enumeration of the same set.
 */
export const DOTA_LANGUAGES: readonly string[] = [
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
 * @param launched  a `-language` value, if one is set
 * @param audio     the voice language from the game's own settings
 * @returns the folder, and whether a parameter chose it
 */
export function modFolderFor(launched: string | null | undefined, audio: string | null | undefined): { suffix: string; followed: boolean } {
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
export function folderFor(audio: string | null | undefined): string {
  return audio && MOD_FOLDERS.includes(audio) ? audio : FALLBACK_FOLDER;
}


/** UI + audio language the game wrote at its last boot, or null if it never ran. */
export function bootLanguages(gamePath: string | null | undefined): { ui: string | null; audio: string | null } | null {
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

/** Every dota_* folder on disk, with what is inside each. */
export function langFolders(gamePath: string | null | undefined): LangFolder[] {
  if (!gamePath) return [];
  const out: LangFolder[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(gamePath, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  for (const name of names) {
    const m = name.match(/^dota_(.+)$/i);
    if (!m) continue;
    const suffix = m[1].toLowerCase();
    if (['addons', 'lv', 'core', 'mods'].includes(suffix)) continue; // not language layers; dota_mods is ours
    let files: string[] = [];
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
export function detectLangSuffix(gamePath: string | null | undefined): LangDetection {
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
 * @param langs  a setting left out is left as it is
 */
export function writeBootLanguages(gamePath: string, { ui, audio }: { ui?: string | null; audio?: string | null }): { ui?: string | null; audio?: string | null } {
  const file = path.join(gamePath, 'dota', 'cfg', 'boot.vcfg');
  let text: string | null = null;
  try { text = fs.readFileSync(file, 'utf-8'); } catch { /* first write */ }
  const pairs = ([['UILanguage', ui], ['AudioLanguage', audio]] as [string, string | null | undefined][]).filter(([, v]) => v);
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

export { launchLanguage, launchOptions, steamLanguage } from './gamelang-steam.ts';
export { voiceInstalled, ensureLangFolder, moveLangFolder } from './gamelang-folders.ts';

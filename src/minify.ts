/* Living next to Minify.
 *
 * The two apps reach the game by different routes, and the routes are not equivalent. The
 * rules underneath both are in src/gamelang.ts, which is the one place they are written down.
 *
 * This app: set the voice language in Dota's own settings to one of the three that have a
 * folder, and fill that folder. The folders already exist on every install, English voices
 * keep playing because the chosen voice pack was never downloaded, and the player still picks
 * whatever text language they want.
 *
 * Minify: put `-language <locale>` in Steam's launch options (Minify/core/steam.py,
 * fix_launch_options) and fill the folder that names. The folder does not exist until Minify
 * creates it with a gameinfo.gi of its own; the parameter locks both language settings, so
 * getting English text back needs the VPK of English localization it ships; and setting any
 * of it up means writing into Steam's own config.
 *
 * Its own locale is "minify", which is not a language, and since the 2026-07-24 update the
 * game mounts nothing by that name - which is why its newer releases moved to Dutch. Dutch is
 * a language, so dota_dutch does mount, and that is the version that can hold the folder
 * instead of us. The author knows all of this; the Dutch move and the English-fix VPK are the
 * answer to it, not an oversight to point out.
 *
 * None of which is a fight to win. It is a thing to be able to explain in a sentence, so
 * whoever is looking at a game with no mods in it knows why.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listVpkPathsFile } from './vpk.ts';

/** What Minify's own config says about where it writes. */
interface MinifyConfig { outputPath: string | null; locale: string | null; folder: string | null }

/** Minify as this app sees it; see readMinify. */
export interface MinifyState {
  present: boolean; folder: string | null; mods: number; mounts: boolean;
  mounted: string | null; ourFolder: string; sharing: boolean;
  live: 'ours' | 'minify' | 'both' | 'neither' | 'unknown'; declared: boolean; prelaunch: boolean;
  reservedLabel: string;
}

/** Its own locale, which is not a language Dota knows. */
export const MINIFY_FOLDER = 'minify';
/** The real language it moved to, whose folder Dota does mount. */
export const MINIFY_BORROWED = 'dutch';

/* The pak slots Minify writes, and the smaller set we refuse to hand out.
 *
 * MINIFY_PAKS is recognition: a pak sitting in one of these slots is its work, so the master
 * switch does not rename it and the foreign-file scan does not offer it up. 65 is its merged
 * VPK mods, 66 what it compiles and 67 what its d2pfx browser installs, all three from its
 * ARCHITECTURE.md; 99 is where releases up to v1.14rc6 wrote the English fix.
 *
 * RESERVED is smaller, and the difference is the point. We hand out pak02 to pak99, and a
 * slot only has to be kept empty when Minify might write it LATER - reading the folder today
 * cannot see a program that gets installed next week. That is why 65 to 67 stay blocked
 * whether or not it is on the machine.
 *
 * 99 no longer belongs in that set. Minify merged the English localization into pak66 in
 * v1.14rc7 (commit 9ffc8e4, "Include the swap into main vpk"; #English Fix/manifest.json is
 * gone with it), so nothing will write there in future and the slot is ours to use. Anybody
 * still on an older release has a pak99 on disk already, which the allocator reads off the
 * folder like any other occupied slot - and MINIFY_PAKS still knows whose it is. The author
 * asked for exactly this: detect the file rather than blindly reserve the number. */
const MINIFY_PAKS: readonly number[] = [65, 66, 67, 99];
export const RESERVED_PAKS: readonly number[] = [65, 66, 67];

/* The reserved range as the interface says it out loud.
 *
 * The Library told people "pak65-67 and pak99 are left to it" for a release after pak99 stopped
 * being reserved, because the sentence carried its own copy of the numbers. Built from the list
 * instead, so the promise on screen and the slots the allocator actually skips cannot disagree
 * again. */
export const RESERVED_LABEL = RESERVED_PAKS.length > 1
  ? `pak${RESERVED_PAKS[0]}-${RESERVED_PAKS[RESERVED_PAKS.length - 1]}`
  : `pak${RESERVED_PAKS[0]}`;

/**
 * Is this file in the language folder one of Minify's paks?
 *
 * Reserving the slots keeps us from writing over its work, which is only half the bargain.
 * The other half is not touching what it wrote: the master switch sweeps the folder and
 * renames every mod file in it, and the foreign-file scan offers the user everything in there
 * that is not ours to adopt, disable or delete. Sharing one folder is the arrangement we tell
 * people to make, so in that arrangement both of those would reach into another program.
 *
 * Matches the dir file and its data volumes: pak66_dir.vpk, pak66_000.vpk, and the same with
 * an .off or .moff already on the end.
 * @param baseLower a file name, lowercased
 */
export function isMinifyFile(baseLower: string): boolean {
  const m = String(baseLower).match(/^pak(\d{2})_(?:dir|\d{3})\.vpk(?:\.off|\.moff)?$/);
  return !!m && MINIFY_PAKS.includes(Number(m[1]));
}

/* How Minify marks its own work, and how it recognises it again.
 *
 * It packs metadata files into every VPK it builds and checks for them before deleting one
 * (Minify/patch/vpk_utils.py, is_minify_pak). Reading the same marker is better than reasoning
 * from slot numbers: a slot says where a file sits, the marker says who made it, and it is the
 * only thing that can identify its maps/dota.vpk - a path with no number to reserve.
 *
 * Reading their convention rather than proposing one costs nothing and needs no agreement.
 */
const MINIFY_MARKERS: readonly string[] = ['minify_mods.json', 'minify_vpk_mods.txt', 'minify_version.txt'];

/**
 * Was this VPK built by Minify? Reads the archive index only, never the content.
 * @param file  full path to a *_dir.vpk
 */
export function isMinifyPak(file: string): boolean {
  try {
    const names = listVpkPathsFile(file).map((n) => String(n).toLowerCase());
    return MINIFY_MARKERS.some((m) => names.includes(m));
  } catch {
    return false; // unreadable, half-written, or not a VPK: not something to claim
  }
}

/** Where Minify keeps the settings it publishes about itself. */
function configPath(): string {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, 'Dota2-Minify', 'config', 'minify_config.json');
}

/**
 * What Minify says about itself, or null. Its own config beats anything we could infer: it
 * names the locale it sets, which is the whole question between the two apps.
 */
export function readConfig(file = configPath()): MinifyConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const outputPath = typeof raw.output_path === 'string' ? raw.output_path : null;
    const locale = typeof raw.output_locale === 'string' ? raw.output_locale.toLowerCase() : null;
    if (!outputPath && !locale) return null;
    return { outputPath, locale, folder: folderOfPath(outputPath) };
  } catch {
    return null; // not installed, or a version that keeps its settings somewhere else
  }
}

/* The suffix of the folder a path ends in: ...\\game\\dota_dutch -> "dutch".
 *
 * This is the field that matters, and it is not output_locale. Asked for English, Minify
 * records output_locale "english" - the language the player chose - while writing into
 * dota_dutch, because Dutch is the folder it borrows to make English work. Reading the locale
 * had this app announce a folder called dota_english, which exists nowhere.
 */
function folderOfPath(outputPath: string | null | undefined): string | null {
  if (!outputPath) return null;
  const last = String(outputPath).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  const m = last.match(/^dota_(.+)$/i);
  return m ? m[1].toLowerCase() : null;
}

/* Has Minify put itself in front of the game's own launch?
 *
 * v1.14rc7 added "Run patches upon launch if required", on by default, and it works by writing
 * a wrapper into Steam's launch options for Dota:
 *
 *   cmd /c "<...>\Dota2-Minify.exe" prelaunch && %command%        (bash -c "... prelaunch" && on Linux)
 *
 * so pressing Play runs Minify first and starts the game only once it returns. This app is not
 * in that path at all - it opens steam://rungameid/570, exactly what the Play button does - but
 * it is the one people have open when the game does not start, so it is the one that should be
 * able to say what is going on. Worth naming because the wrapper can swallow a launch: when
 * that patch decides the launch options need fixing it shuts Steam down (`-exitsteam`) and
 * waits for it, and Steam going away takes the launch with it.
 *
 * Matched on what the wrapper is rather than on one release's exact spelling: the word
 * `prelaunch` as a token, Minify named in the same line, and the `&&` that hands over to the
 * game. Nobody's own launch options are all three by accident.
 * @param options  Steam's launch options for Dota, unescaped
 */
export function prelaunchHook(options: string | null | undefined): boolean {
  const s = String(options || '');
  return /(?:^|[\s"])prelaunch(?:[\s"]|$)/i.test(s) && /minify/i.test(s) && s.includes('&&');
}

/**
 * Where Minify is, whether its folder is the one the game mounts, and whose mods are live.
 * @param p.folders  every dota_* folder on disk, from gamelang.langFolders()
 * @param p.audio  the voice language the game is set to, which names the folder it mounts
 * @param p.gameLanguages  the languages Dota will accept for that setting
 * @param p.ourFolder   the suffix this app installs into, from gamelang.folderFor()
 * @param p.ourMods     how many mods this app has installed
 * @param p.launchOptions  Steam's launch options for Dota, unescaped
 * @param p.config  what Minify's own config says, read from disk unless a test hands one in
 * @param p.countMods  how many of the files in a folder are Minify's own, when the caller can look at them
 */
export function readMinify({
  folders = [], audio = null, gameLanguages = [], ourFolder, ourMods = 0, config = readConfig(),
  countMods = null, launchOptions = null,
}: {
  folders?: { suffix: string; modFiles: number }[]; audio?: string | null; gameLanguages?: readonly string[];
  ourFolder: string; ourMods?: number; config?: { folder?: string | null; outputPath?: string | null; locale?: string | null } | null;
  countMods?: ((suffix: string) => number) | null; launchOptions?: string | null;
}): MinifyState {
  const at = (suffix: string) => folders.find((f) => f.suffix === suffix) || null;
  // where it writes, which is the question - not the language the player asked it for
  const declared = config ? (config.folder || folderOfPath(config.outputPath)) : null;

  /* Its own folder is proof by name. The borrowed one is proof only when it holds mods:
   * dota_dutch is a folder Valve ships voice for, so an empty one means somebody simply owns
   * the Dutch voice pack, and calling that Minify would be a guess dressed as a finding. */
  const borrowed = at(MINIFY_BORROWED);
  const folder = declared
    || (at(MINIFY_FOLDER) ? MINIFY_FOLDER : (borrowed && borrowed.modFiles > 0 ? MINIFY_BORROWED : null));
  const present = !!folder;
  /* Its own files, not everything in the folder: once the two share one, the folder's total
   * is both of ours. A caller that can look at the files passes a counter; without one the
   * total is the only figure available, which is right while the folders are separate. */
  const mods = folder ? (countMods ? countMods(folder) : (at(folder)?.modFiles || 0)) : 0;

  /* Whether the folder it fills is one Dota can be pointed at. Its default locale is not a
   * language, so on today's game that folder is never mounted and its mods do nothing - no
   * matter what either app does. Worth saying plainly; it is not a conflict with us. */
  const mounts = present && gameLanguages.includes(folder);

  const mounted = audio ? String(audio).toLowerCase() : null;
  const sharing = present && folder === ourFolder;

  let live: MinifyState['live'] = 'unknown';
  if (mounted) {
    const oursLive = mounted === ourFolder && ourMods > 0;
    const minifyLive = mounts && mounted === folder && mods > 0;
    if (sharing && (oursLive || minifyLive)) live = 'both';
    else if (oursLive && minifyLive) live = 'both';
    else if (oursLive) live = 'ours';
    else if (minifyLive) live = 'minify';
    else live = 'neither';
  }

  return {
    present, folder, mods, mounts, mounted, ourFolder, sharing, live, declared: !!declared,
    reservedLabel: RESERVED_LABEL,
    // true even when nothing else here says it is installed: the wrapper is in Steam's config,
    // and it stays there after somebody deletes the program without uninstalling it
    prelaunch: prelaunchHook(launchOptions),
  };
}


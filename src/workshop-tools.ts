/* A copy of the Workshop Tools kept in userData, for a Linux machine that plays the Linux build.
 *
 * On Linux the tools come only with the Windows build of Dota, which Steam installs while the game
 * is forced to run through Proton; switch back to the Linux build to play and Steam takes the
 * Windows files away, resourcecompiler.exe with them. So the first time the app sees the tools in
 * the game it copies them here, and the compiler (src/resource-compiler.ts) runs this copy whenever
 * the game's own is gone. Nobody has to keep a Proton build installed to compile.
 *
 * What is copied is what only the Windows build has: game/bin (win64, the tools themselves, 137
 * files and 700 MB on 2026-10-25, and the few files beside it), and in game/dota and game/core
 * their own bin/win64 (client, server, host and modtools), the DX11 shaders (shaders_pc_*; the
 * Linux build has pcgl and vulkan ones), the tools' entity definitions (*.fgd) and their asset
 * list (readonly_tools_asset_info.bin): 456 MB more. That list is the whole difference between the
 * two builds' game/dota and game/core, both listed on 2026-10-25, and the Linux one has none of
 * these. The rest of the game is not copied: the compiler finds the game through its own place,
 * two folders up from win64, and every other entry of game/dota and game/core here is a link to the
 * user's game, whose content is the same for both builds. The first copy linked game/dota and
 * game/core whole, and once Steam had taken the Windows build away the compiler stopped at "Unable
 * to load module modtools, error 126": game/dota/bin/win64 had gone with it (J0nathan550,
 * 2026-10-25). content/ and game/dota_addons/ here are folders of the copy's own, so what a compile
 * writes stays in userData and never reaches the game through a link.
 *
 * It is copied into a folder of its own and renamed into place once whole, so a copy cut short is
 * never run; and copied again when the game's tools change, which is what a Dota patch does while
 * the Proton build is installed. Deleted from Settings, it is not copied again until the game's
 * tools change: a gigabyte the user said no to is not taken back on the next start.
 */
import fs from 'node:fs';
import path from 'node:path';
import { compilerIn, installOf } from './resource-compiler.ts';

/** What kept.json says of the copy: the tools it was copied from, its size, and how it is laid out. */
export interface KeptInfo { from: string; stamp: string; bytes: number; at: number; layout: number }

/* How the copy is laid out. A copy of an older layout is not run, and is made again when it can be:
 * the first linked game/dota whole, the second had no .fgd files, and neither compiles once the
 * Windows build is gone. */
const LAYOUT = 3;

/** The game's folders the compiler reads, each part copied and the rest linked. */
const MODS = ['dota', 'core'];

/** Whether a file of game/dota or game/core, by its path inside it, is the Windows build's alone. */
export function windowsOnly(rel: string): boolean {
  const p = rel.split(path.sep).join('/');
  return p.startsWith('bin/win64/') || /^shaders_pc_[^/]*$/i.test(p) || /\.fgd$/i.test(p) || p === 'readonly_tools_asset_info.bin';
}

/** The game's tools as they are now: a copy is of these when the stamp matches. */
function stampOf(exe: string): string | null {
  try { const st = fs.statSync(exe); return `${st.size}|${st.mtimeMs}`; } catch { return null; }
}

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}

/** Every file under a folder, as paths relative to it; none when it is not there. */
function filesUnder(dir: string, base = dir): string[] {
  let names: fs.Dirent[] = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return names.flatMap((e) => (e.isDirectory()
    ? filesUnder(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));
}

/** What to copy of a game folder of the Windows build, as paths relative to game/. */
export function windowsFiles(game: string): string[] {
  const bin = path.join(game, 'bin');
  const top = (dir: string) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { return []; } };
  return [
    // linuxsteamrt64 beside it is the Linux game, and the user has it already
    ...top(bin).map((f) => path.join('bin', f)),
    ...filesUnder(path.join(bin, 'win64')).map((f) => path.join('bin', 'win64', f)),
    ...MODS.flatMap((mod) => filesUnder(path.join(game, mod)).filter(windowsOnly).map((f) => path.join(mod, f))),
  ];
}

/*
 * The copy's game/dota and game/core: a real folder holding what was copied, and a link for every
 * other entry of the game's, made again on each use. A file a patch adds is linked the next time,
 * one it removes loses its link, and a game moved to another library is linked where it is now.
 * Into a folder the copy has of its own (bin holding win64, tools holding an .fgd) it goes down and does the
 * same; what was copied is never touched.
 */
function mirror(real: string, copy: string) {
  fs.mkdirSync(copy, { recursive: true });
  let names: string[] = [];
  try { names = fs.readdirSync(real); } catch { /* the game has none: nothing to link */ }
  for (const name of names) {
    const at = path.join(copy, name);
    const target = path.join(real, name);
    let st: fs.Stats | null = null;
    try { st = fs.lstatSync(at); } catch { /* not there yet */ }
    if (st && !st.isSymbolicLink()) {
      if (st.isDirectory() && fs.lstatSync(target).isDirectory()) mirror(target, at);
      continue;
    }
    if (st && fs.readlinkSync(at) === target) continue;
    if (st) fs.rmSync(at, { force: true });
    fs.symlinkSync(target, at);
  }
  // a link to anything but this entry of the game as it is now: a file gone, or the library moved from
  const here = new Set(names);
  for (const name of fs.readdirSync(copy)) {
    const at = path.join(copy, name);
    if (fs.lstatSync(at).isSymbolicLink() && (!here.has(name) || fs.readlinkSync(at) !== path.join(real, name))) fs.rmSync(at, { force: true });
  }
}

/** The copy, as the compiler and Settings take it. */
export function createToolsKeeper({ dir, gamePath, log = () => {}, onStep = () => {} }: {
  /** where the copy is kept (userData/workshop-tools) */
  dir: string;
  gamePath: () => string | null | undefined;
  log?: (msg: string) => void;
  /** files copied of how many, for the bar at the bottom */
  onStep?: (done: number, total: number) => void;
}) {
  const record = path.join(dir, 'kept.json');
  const declinedFile = path.join(dir, 'declined.json');
  const tree = path.join(dir, 'tree');
  const exeIn = (root: string) => compilerIn(path.join(root, 'game'));
  let copying: Promise<boolean> | null = null;

  /** The game's own compiler and its stamp, when the game has the tools. */
  function gameTools(): { exe: string; stamp: string } | null {
    const game = gamePath();
    const exe = game ? compilerIn(game) : null;
    const stamp = exe && installOf(exe) ? stampOf(exe) : null;
    return exe && stamp ? { exe, stamp } : null;
  }

  const link = (root: string, game: string) => { for (const mod of MODS) mirror(path.join(game, mod), path.join(root, 'game', mod)); };

  function info(): KeptInfo | null {
    const kept = readJson<KeptInfo>(record);
    return kept && kept.layout === LAYOUT && fs.existsSync(exeIn(tree)) ? kept : null;
  }

  /** The copy's compiler and its install, linked to the game in Settings; null when there is none. */
  function usable(): { exe: string; install: string } | null {
    const game = gamePath();
    if (!info() || !game) return null;
    try { link(tree, game); } catch (err) { log(`workshop tools: the copy could not be linked to ${game}: ${(err as Error).message}`); return null; }
    const exe = exeIn(tree);
    const install = installOf(exe);
    return install ? { exe, install } : null;
  }

  /** Whether the game has tools the copy is not of: a copy can be made, or made again. */
  function keepable(): boolean {
    const own = gameTools();
    return !!own && own.stamp !== info()?.stamp;
  }

  /** keepable, and the user has not said no to these tools. */
  function wanted(): boolean {
    return keepable() && readJson<{ stamp: string }>(declinedFile)?.stamp !== gameTools()?.stamp;
  }

  async function copyNow(): Promise<boolean> {
    const own = gameTools();
    const game = gamePath();
    if (!own || !game) return false;
    const files = windowsFiles(game);
    const part = `${tree}.part`;
    fs.rmSync(part, { recursive: true, force: true });
    let bytes = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const to = path.join(part, 'game', files[i]);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        await fs.promises.copyFile(path.join(game, files[i]), to);
        bytes += fs.statSync(to).size;
        onStep(i + 1, files.length);
      }
      for (const d of ['content/dota_addons', 'game/dota_addons']) fs.mkdirSync(path.join(part, d), { recursive: true });
      link(part, game);
      // the game's tools may have changed under the copy (Steam updating them): copied again next time
      if (stampOf(own.exe) !== own.stamp) throw new Error('the game\'s tools changed while they were copied');
      fs.rmSync(tree, { recursive: true, force: true });
      fs.renameSync(part, tree);
    } catch (err) {
      fs.rmSync(part, { recursive: true, force: true });
      throw err;
    }
    fs.writeFileSync(record, JSON.stringify({ from: own.exe, stamp: own.stamp, bytes, at: Date.now(), layout: LAYOUT } satisfies KeptInfo));
    fs.rmSync(declinedFile, { force: true });
    log(`workshop tools: kept a copy of ${files.length} files, ${(bytes / 1048576).toFixed(0)} MB, from ${game}`);
    return true;
  }

  /** Copy the game's tools here when they are new to the copy; once at a time. @returns whether it copied */
  function keep({ force = false } = {}): Promise<boolean> {
    if (!force && !wanted()) return Promise.resolve(false);
    copying ||= copyNow().finally(() => { copying = null; });
    return copying;
  }

  /* Deleted on the user's word, and remembered: the same tools are not copied back behind their back.
   * rmSync takes the links away, not what they point at, so the game stays where it is. */
  function remove(): void {
    const kept = info();
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(record, { force: true });
    const stamp = gameTools()?.stamp || kept?.stamp;
    if (stamp) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(declinedFile, JSON.stringify({ stamp })); }
  }

  /** Whether a copy is here that is not run: made in an older layout, to be made again. */
  function outdated(): boolean {
    const kept = readJson<KeptInfo>(record);
    return !!kept && kept.layout !== LAYOUT;
  }

  return { usable, info, outdated, keepable, wanted, keep, remove };
}

/** The copy as the compiler and the IPC take it. */
export type ToolsKeeper = ReturnType<typeof createToolsKeeper>;

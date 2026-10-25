/* Running a Windows program on Linux, for the one that has no Linux build: resourcecompiler.exe,
 * Valve's compiler from the Workshop Tools (src/resource-compiler.ts).
 *
 * The app keeps a Wine prefix of its own in userData/wine rather than borrowing ~/.wine. A prefix
 * is a whole pretend Windows, and the user's may be set up for a game, a 32-bit one, or somebody's
 * registry tweaks; the compiler wants none of that, and a prefix that is only ours can be deleted
 * and made again without asking anybody. It is made once, by the first compile or ahead of it from
 * Settings: wineboot takes a few seconds, and Wine offers to download Mono and Gecko into a new prefix in a window of its
 * own unless it is told not to (WINEDLLOVERRIDES below), which the compiler needs neither of.
 *
 * Which Wine: the system's, on PATH, and when there is none the one inside a Proton that Steam
 * installed. Anybody running Dota on Linux has Steam, and most have a Proton; its files/bin/wine
 * runs on its own (Proton - Experimental's, 2026-10-25). Older Protons kept it under dist/.
 *
 * A path goes to a Windows program as Windows spells it. A new prefix maps Z: to the root of the
 * file system, so /home/x/a.vmdl is Z:\home\x\a.vmdl, with no call into Wine to find that out.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linuxSteamRoots, parseLibraryFolders, steamappsDir } from './steam.ts';

/** The env a Windows program runs in under our prefix: quiet, 64-bit, and no Mono or Gecko offer. */
export function wineEnv(prefix: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, WINEPREFIX: prefix, WINEARCH: 'win64', WINEDEBUG: '-all', WINEDLLOVERRIDES: 'mscoree,mshtml=' };
}

/** A Linux path as a program under Wine reads it, through the Z: drive every new prefix has. */
export function winePath(p: string): string {
  return `Z:${path.resolve(p).replace(/\//g, '\\')}`;
}

/** The Wine inside each Proton Steam installed, in every library it knows of. */
export function protonWines(steamRoots: string[]): string[] {
  const libs: string[] = [];
  for (const root of steamRoots) {
    if (!fs.existsSync(root)) continue;
    libs.push(root);
    try { libs.push(...parseLibraryFolders(fs.readFileSync(path.join(steamappsDir(root), 'libraryfolders.vdf'), 'utf-8'))); } catch { /* no list: the root alone */ }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const lib of libs) {
    const common = path.join(steamappsDir(lib), 'common');
    let names: string[] = [];
    try { names = fs.readdirSync(common); } catch { continue; }
    // the newest first, by name: "Proton 9.0" is after "Proton 8.0", and Experimental is on its own
    for (const name of names.filter((n) => /^proton/i.test(n)).sort().reverse()) {
      for (const sub of ['files', 'dist']) {
        const wine = path.join(common, name, sub, 'bin', 'wine');
        if (!seen.has(wine) && fs.existsSync(wine)) { seen.add(wine); out.push(wine); }
      }
    }
  }
  return out;
}

/** Every Wine on PATH, by the names it goes by. */
export function pathWines(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  return dirs.flatMap((d) => ['wine', 'wine64'].map((n) => path.join(d, n))).filter((p) => fs.existsSync(p));
}

/** The Wine to run with: the system's first, then a Proton's; null when there is neither. */
export function findWine({ env = process.env, home = os.homedir() }: { env?: NodeJS.ProcessEnv; home?: string } = {}): string | null {
  return pathWines(env)[0] || protonWines(linuxSteamRoots(home, env))[0] || null;
}

/** What a prefix leaves on disk once wineboot has made it; the marker is ours, written after. */
const READY = '.d2mm-ready';

/** Whether a prefix is made and was made whole. */
export function prefixReady(prefix: string): boolean {
  return fs.existsSync(path.join(prefix, READY)) && fs.existsSync(path.join(prefix, 'system.reg'));
}

/** How a program is run: its exit code and everything it printed. */
export type RunProcess = (exe: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<{ code: number; out: string }>;

/**
 * Make the prefix, once. A prefix wineboot left half made (the app closed in the middle) has no
 * marker, so it is thrown away and made again rather than trusted.
 */
export async function ensurePrefix(prefix: string, wine: string, run: RunProcess, log: (msg: string) => void = () => {}): Promise<void> {
  if (prefixReady(prefix)) return;
  fs.rmSync(prefix, { recursive: true, force: true });
  fs.mkdirSync(prefix, { recursive: true });
  log(`wine: making the prefix in ${prefix} with ${wine}`);
  const { code, out } = await run(wine, ['wineboot', '--init'], { env: wineEnv(prefix), timeoutMs: 5 * 60 * 1000 });
  if (code !== 0 || !fs.existsSync(path.join(prefix, 'system.reg'))) {
    throw new Error(`wineboot exited with ${code}: ${out.trim().split('\n').slice(-5).join(' | ')}`);
  }
  fs.writeFileSync(path.join(prefix, READY), JSON.stringify({ wine, at: Date.now() }));
}

/* resourcecompiler.exe: Valve's compiler from the Dota 2 Workshop Tools, run on sources the app
 * staged, for the compiled files an arcana base is made of (src/arcana-bases.ts).
 *
 * The bases J0nathan550 publishes were made by hand: the item's model taken apart in Source 2
 * Viewer, its .vmdl put at the plain hero's path with its meshes and animations beside the item's,
 * and the lot compiled in the Workshop Tools, so every file is at a path the plain hero reads. An
 * arcana nobody has made a base for yet can go through the same compiler, and this file is the
 * compiler half of that: given sources at their paths, it hands back the compiled files.
 *
 * The compiler is not ours to ship. It is Valve's, it is not open source, and toolchain.ts says
 * why nothing proprietary is downloaded by this app; it comes with the Workshop Tools, a free DLC
 * of Dota's in Steam. So it is found where Steam put it, game/bin/win64 of the user's game, or in
 * a file the user picked in Settings. The tools exist for the Windows build of Dota alone, and
 * Linux has no game/bin/win64/resourcecompiler.exe: there the user points at one from a Windows
 * copy of the game (Steam installs that copy when Dota is forced to run under Proton), and it runs
 * under Wine in a prefix of the app's (src/wine.ts).
 *
 * How it is run, as BetterSource2Viewer's ResourceCompilerTest runs it: a source under
 * content/dota_addons/<addon>/ of the install the compiler belongs to is compiled into the same
 * path under game/dota_addons/<addon>/, with "-nop4 -f -i <source>" from the compiler's own folder.
 * The addon is ours (d2mm_<id>), made for one compile and deleted after it, so nothing is left in
 * the install either way. Neither folder is one the game mounts: a compile while Dota runs does not
 * touch what it plays with. One compile runs at a time, since every one of them writes the
 * install's asset list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { entryAt, type VpkEntry } from './vpk.ts';
import { ensurePrefix, findWine, prefixReady, winePath, wineEnv, type RunProcess } from './wine.ts';
import { t } from './i18n.ts';

/** The compiler's file name, as the Workshop Tools install it. */
export const COMPILER = 'resourcecompiler.exe';
/* A hero model with its animations is minutes, not seconds: ResourceCompilerTest gives one ten. */
const COMPILE_TIMEOUT_MS = 10 * 60 * 1000;
const ADDON = /^[a-z0-9_]{1,64}$/;

/** Where the Workshop Tools put the compiler in a game folder (dota 2 beta/game). */
export function compilerIn(gamePath: string): string {
  return path.join(gamePath, 'bin', 'win64', COMPILER);
}

/**
 * The install a compiler belongs to, the folder with game/ and content/ in it, or null when it is
 * not one: the compiler finds the game through its own place in game/bin/win64, so a copy of the
 * file anywhere else compiles nothing.
 */
export function installOf(exe: string | null | undefined): string | null {
  if (!exe || path.basename(exe).toLowerCase() !== COMPILER) return null;
  const bin = path.dirname(path.dirname(path.resolve(exe)));
  if (path.basename(path.dirname(path.resolve(exe))).toLowerCase() !== 'win64' || path.basename(bin).toLowerCase() !== 'bin') return null;
  const game = path.dirname(bin);
  return fs.existsSync(exe) && fs.existsSync(path.join(game, 'dota', 'gameinfo.gi')) ? path.dirname(game) : null;
}

/** A path inside an addon, as the game spells it: forward slashes, nothing that climbs out. */
export function safeRel(rel: string): boolean {
  return !!rel && !path.isAbsolute(rel) && !/[\\:\0]/.test(rel) && rel.split('/').every((s) => s && s !== '.' && s !== '..');
}

/** A source file to stage, at its path in the addon (models/heroes/razor/razor.vmdl). */
export interface SourceFile { path: string; data: Buffer }

/** One compile: the addon's sources, and which of them to hand the compiler (it finds what they use). */
export interface CompileJob { id: string; files: SourceFile[]; compile: string[] }

/** What Settings shows of the compiler. */
export interface CompilerState {
  /** the compiler that will run, or null when there is none */
  exe: string | null;
  /** whether it is the one the user picked rather than the game's own */
  chosen: boolean;
  /** whether it runs through Wine here */
  needsWine: boolean;
  wine: string | null;
  prefixReady: boolean;
  /** whether a compile can start without anything more to set up */
  ready: boolean;
}

/** Run a program and settle with its exit code: a non-zero one is an answer, not a failure to run. */
export const runProcess: RunProcess = (exe, args, { cwd, env, timeoutMs }) => new Promise((resolve, reject) => {
  execFile(exe, args, { cwd, env, timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
    const out = `${stdout || ''}${stderr || ''}`;
    if (!err) return resolve({ code: 0, out });
    // a number is the program's own exit code; anything else is that it never ran, or was killed
    if (typeof (err as { code?: unknown }).code === 'number') return resolve({ code: (err as { code: number }).code, out });
    reject(err);
  });
});

/** The last lines of what the compiler said, for an error a person can send along. */
const tail = (out: string, n = 8) => out.trim().split(/\r?\n/).filter(Boolean).slice(-n).join(' | ');

function walk(dir: string, base = dir): string[] {
  let names: fs.Dirent[] = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return names.flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]));
}

/** The compiler as the app runs it: where it is, what it needs, and a compile. */
export function createResourceCompiler({ userDataDir, gamePath, chosen, log = () => {}, platform = process.platform, run = runProcess, wine = () => findWine() }: {
  userDataDir: string;
  /** the game folder in Settings (dota 2 beta/game) */
  gamePath: () => string | null | undefined;
  /** the compiler the user picked in Settings */
  chosen: () => string | null | undefined;
  log?: (msg: string) => void;
  /** the system it runs on; tests name one */
  platform?: NodeJS.Platform;
  run?: RunProcess;
  wine?: () => string | null;
}) {
  const prefix = path.join(userDataDir, 'wine');
  const needsWine = platform !== 'win32';
  let queue: Promise<unknown> = Promise.resolve();

  /** The compiler that runs: the one picked, when it is one, else the game's own. */
  function locate(): { exe: string; install: string; chosen: boolean } | null {
    const picked = chosen();
    if (picked && installOf(picked)) return { exe: picked, install: installOf(picked)!, chosen: true };
    const game = gamePath();
    const own = game ? compilerIn(game) : null;
    const install = installOf(own);
    return own && install ? { exe: own, install, chosen: false } : null;
  }

  function state(): CompilerState {
    const found = locate();
    const w = needsWine ? wine() : null;
    const made = needsWine && prefixReady(prefix);
    return { exe: found?.exe ?? null, chosen: !!found?.chosen, needsWine, wine: w, prefixReady: made, ready: !!found && (!needsWine || (!!w && made)) };
  }

  /** Everything a compile needs before it starts: the compiler, and here Wine with its prefix made. */
  async function prepare(): Promise<{ exe: string; install: string; wine: string | null }> {
    const found = locate();
    if (!found) throw new Error(t('resourcecompiler.exe не найден. Он входит в Dota 2 Workshop Tools: поставь их в Steam или укажи файл вручную'));
    if (!needsWine) return { ...found, wine: null };
    const w = wine();
    if (!w) throw new Error(t('Для resourcecompiler.exe нужен Wine: поставь его из пакетов своей системы или Proton в Steam'));
    await ensurePrefix(prefix, w, run, log);
    return { ...found, wine: w };
  }

  async function compileNow(job: CompileJob): Promise<VpkEntry[]> {
    if (!ADDON.test(job.id)) throw new Error(`not an addon name: ${job.id}`);
    for (const f of job.files) if (!safeRel(f.path)) throw new Error(`not a path inside an addon: ${f.path}`);
    const staged = new Set(job.files.map((f) => f.path));
    for (const c of job.compile) if (!staged.has(c)) throw new Error(`${c} is to be compiled and is not among the sources`);
    const { exe, install, wine: w } = await prepare();
    const addon = `d2mm_${job.id}`;
    const content = path.join(install, 'content', 'dota_addons', addon);
    const out = path.join(install, 'game', 'dota_addons', addon);
    const clean = () => { for (const d of [content, out]) fs.rmSync(d, { recursive: true, force: true }); };
    clean();
    try {
      for (const f of job.files) {
        fs.mkdirSync(path.dirname(path.join(content, f.path)), { recursive: true });
        fs.writeFileSync(path.join(content, f.path), f.data);
      }
      for (const rel of job.compile) {
        const source = path.join(content, rel);
        const args = ['-nop4', '-f', '-i', w ? winePath(source) : source];
        const started = Date.now();
        const { code, out: said } = w
          ? await run(w, [exe, ...args], { cwd: path.dirname(exe), env: wineEnv(prefix), timeoutMs: COMPILE_TIMEOUT_MS })
          : await run(exe, args, { cwd: path.dirname(exe), timeoutMs: COMPILE_TIMEOUT_MS });
        log(`resourcecompiler: ${rel} exited with ${code} after ${((Date.now() - started) / 1000).toFixed(1)} s`);
        if (code !== 0 || !fs.existsSync(path.join(out, `${rel}_c`))) throw new Error(t('resourcecompiler.exe не собрал {0}: {1}', rel, tail(said) || `exit ${code}`));
      }
      // the compiled files, and not the tools' own notes about the addon beside them
      return walk(out).filter((rel) => rel.endsWith('_c') && !/^tools_/.test(rel)).map((rel) => entryAt(rel, fs.readFileSync(path.join(out, rel))));
    } finally {
      clean();
    }
  }

  /** Compile a job, after any compile already running: the files it made, at their paths. */
  function compile(job: CompileJob): Promise<VpkEntry[]> {
    const next = queue.then(() => compileNow(job));
    queue = next.catch(() => {});
    return next;
  }

  return { state, prepare, compile, locate, prefix };
}

/** The compiler as the IPC and the builder take it. */
export type ResourceCompiler = ReturnType<typeof createResourceCompiler>;

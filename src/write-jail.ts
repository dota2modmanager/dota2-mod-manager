/* A run that may write only inside the folders it was given.
 *
 * On 2026-10-03 a sandbox run wrote into the real game. Its settings named a sandbox inside a copy
 * of the repository deleted days before; the app saw no game there, detected the real one through
 * Steam, saved it and rewrote the ownership note in the real language folder. tools/sandbox-pin.js
 * now writes the right path in before every start, which fixes that path. It does not stop the
 * next wrong path: a bug that computes another folder writes there just the same.
 *
 * So a run started with --write-jail=<folder> cannot write anywhere else. Every Node call that
 * changes the disk - a write, an append, a copy's destination, both ends of a rename, a delete, a
 * folder made, a file opened for writing, a stream - is checked before it happens, and one aimed
 * outside throws EPERM and is logged. The check is on the real path: the nearest part of it that
 * exists is resolved with realpath, so "..", a symlink or a Windows junction inside the folder that
 * points out of it is outside. Reading is untouched, which is how the sandbox copies gameinfo out
 * of the real game.
 *
 * The sandbox launches set it (npm run start:sandbox, tools/e2e.mjs, tools/sim/run.mjs); the temp
 * folder and the folders a screenshot or a log mirror were asked into are let in beside it
 * (src/main.ts). Steam's own detection is held to the same folders (src/steam.ts), so the app never
 * adopts the real game in the first place. A copy started without the switch is not affected.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folders writes are held to, each as its real path; empty when no jail is up. */
let roots: string[] = [];
let refusals = 0;
/** Where a refusal is reported: stderr until the app's log exists, then the log (src/main.ts). */
let report: (msg: string) => void = (msg) => process.stderr.write(`${msg}
`);

const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** The real path of `p`: its nearest existing ancestor resolved through links, plus the rest as written. */
function realOf(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      fs.lstatSync(cur);
      break;
    } catch {
      const up = path.dirname(cur);
      if (up === cur) break;
      rest.unshift(path.basename(cur));
      cur = up;
    }
  }
  let real = cur;
  try { real = fs.realpathSync.native(cur); } catch { /* a dangling link: judged by where it sits */ }
  return path.join(real, ...rest);
}

/** Whether `p` is inside the jail; always true when no jail is up. */
export function insideJail(p: string | null | undefined): boolean {
  if (!roots.length) return true;
  if (!p) return false;
  const real = fold(realOf(String(p)));
  return roots.some((root) => real === root || real.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
}

/** The folders the jail holds writes to, or none. */
export function jailRoots(): string[] {
  return [...roots];
}

/** How many writes the jail refused since it went up. */
export function jailRefusals(): number {
  return refusals;
}

/** The folders a --write-jail=<a><delimiter><b> switch on the command line names, or none. */
export function jailFromArgv(argv: string[]): string[] {
  const arg = argv.find((a) => a.startsWith('--write-jail='));
  if (!arg) return [];
  return arg.slice('--write-jail='.length).split(path.delimiter).map((s) => s.trim()).filter(Boolean);
}

/**
 * Put the jail up for this run if its command line asks for one: the folders it names, the temp
 * folder, and the folders the dev switches were asked to write into - a screenshot (MM_SHOT), a log
 * mirror (MM_DIAG), a diagnostics report (MM_DIAG_OUT), the simulator's results (MM_SIM_OUT).
 * @returns the folders it holds writes to, or none when the run is not jailed
 */
export function jailThisRun(argv: string[], env: NodeJS.ProcessEnv): string[] {
  const asked = jailFromArgv(argv);
  if (!asked.length) return [];
  const along = [
    ...[env.MM_SHOT, env.MM_DIAG, env.MM_DIAG_OUT].filter((p): p is string => !!p).map((p) => path.dirname(path.resolve(p))),
    ...[env.MM_SIM_OUT].filter((p): p is string => !!p).map((p) => path.resolve(p)),
  ];
  installWriteJail([...asked, os.tmpdir(), ...along], (msg) => report(msg));
  return jailRoots();
}

/**
 * Send refusals to `log` from now on: the app's diagnostics log, where the e2e looks for them. A
 * jailed run says so there first, so a run that should have been jailed and was not shows too.
 */
export function jailLogTo(log: (msg: string) => void): void {
  report = log;
  if (roots.length) log(`write jail: writes held to ${roots.join(' | ')}`);
}

type AnyFn = (...args: unknown[]) => unknown;

/** Which arguments of each call are paths it changes. A copy reads its source, so only the destination counts. */
const PATHS: Record<string, number[]> = {
  writeFile: [0], appendFile: [0], rm: [0], rmdir: [0], unlink: [0], mkdir: [0], mkdtemp: [0],
  truncate: [0], utimes: [0], lutimes: [0], chmod: [0], lchmod: [0], chown: [0], lchown: [0],
  rename: [0, 1], copyFile: [1], cp: [1], symlink: [1], link: [1],
};
const WRITE_FLAGS = /[wa+]/;

const pathArg = (v: unknown): string | null => {
  if (typeof v === 'string') return v;
  if (v instanceof URL) return v.protocol === 'file:' ? fileURLToPath(v) : null;
  if (Buffer.isBuffer(v)) return v.toString();
  return null; // a file descriptor: the open that made it was checked
};

const writes = (flags: unknown): boolean => {
  if (typeof flags === 'string') return WRITE_FLAGS.test(flags);
  if (typeof flags === 'number') {
    const c = fs.constants;
    return (flags & (c.O_WRONLY | c.O_RDWR | c.O_CREAT | c.O_TRUNC | c.O_APPEND)) !== 0;
  }
  return false;
};

/**
 * Hold every write in this process to `folders` (and anything inside them) from now on. Returns
 * the function that takes the jail down again, which only the tests call.
 */
export function installWriteJail(folders: string[], log: (msg: string) => void = () => {}): () => void {
  if (!folders.length) throw new Error('a write jail needs at least one folder');
  roots = folders.map((f) => {
    fs.mkdirSync(f, { recursive: true });
    return fold(fs.realpathSync.native(path.resolve(f)));
  });
  refusals = 0;

  const refuse = (op: string, p: string) => {
    refusals++;
    log(`write jail: refused ${op} ${p}`);
    return Object.assign(new Error(`EPERM: write outside the sandbox refused, ${op} '${p}'`), { code: 'EPERM', errno: -4048, syscall: op, path: p });
  };
  /** The first changed path outside the jail, or null. */
  const offender = (name: string, args: unknown[]): string | null => {
    const at = name === 'open' || name === 'createWriteStream'
      ? (name === 'open' ? (writes(args[1]) ? [0] : []) : [0])
      : PATHS[name] || [];
    for (const i of at) {
      const p = pathArg(args[i]);
      if (p !== null && !insideJail(p)) return p;
    }
    return null;
  };

  const undo: (() => void)[] = [];
  const swap = (owner: Record<string, unknown>, key: string, make: (real: AnyFn) => AnyFn) => {
    const real = owner[key];
    if (typeof real !== 'function') return;
    owner[key] = make(real as AnyFn);
    undo.push(() => { owner[key] = real; });
  };
  const live = fs as unknown as Record<string, unknown>;
  const promises = fs.promises as unknown as Record<string, unknown>;
  for (const name of [...Object.keys(PATHS), 'open']) {
    // the synchronous form throws
    swap(live, `${name}Sync`, (real) => function jailed(this: unknown, ...args: unknown[]) {
      const bad = offender(name, args);
      if (bad) throw refuse(name, bad);
      return real.apply(this, args);
    });
    // the callback form answers through its callback, as a refused system call would
    swap(live, name, (real) => function jailed(this: unknown, ...args: unknown[]) {
      const bad = offender(name, args);
      if (bad) {
        const err = refuse(name, bad);
        const cb = args[args.length - 1];
        if (typeof cb === 'function') { process.nextTick(cb as AnyFn, err); return undefined; }
        throw err;
      }
      return real.apply(this, args);
    });
    // the promise form rejects
    swap(promises, name, (real) => function jailed(this: unknown, ...args: unknown[]) {
      const bad = offender(name, args);
      if (bad) return Promise.reject(refuse(name, bad));
      return real.apply(this, args);
    });
  }
  swap(live, 'createWriteStream', (real) => function jailed(this: unknown, ...args: unknown[]) {
    const bad = offender('createWriteStream', args);
    if (bad) throw refuse('createWriteStream', bad);
    return real.apply(this, args);
  });

  return () => {
    for (const put of undo.reverse()) put();
    roots = [];
  };
}

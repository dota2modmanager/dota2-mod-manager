/* Two app processes over twin copies of one state: the TypeScript main process as the Tauri
 * shell runs it (src-tauri/host/host.ts) and the Rust owner (`mm-cli owner`,
 * crates/mm-cli/src/owner_wire.rs). Both speak the same wire, so one script of channel calls
 * drives both, and what each answers, asks of the shell, tells the window and leaves on disk is
 * compared (test/rust-owner.test.ts).
 *
 * Each process is held to its own copy with --write-jail, and the game in each copy is a copy of
 * the sandbox's (npm run sandbox:seed), so neither can write anywhere else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const CLI = path.join(ROOT, 'target', 'debug', process.platform === 'win32' ? 'mm-cli.exe' : 'mm-cli');
export const SANDBOX_GAME = path.join(ROOT, 'sandbox', 'steamapps', 'common', 'dota 2 beta', 'game');
export const SANDBOX_MODS = path.join(ROOT, 'sandbox', 'mods');
const MARK = '\u0001MM ';

/** What the shell is asked: the method and its arguments. */
export type Asked = { method: string; args: unknown[] };
/** The harness's answer to a request: a value, or {error}. */
export type Reply = (method: string, args: unknown[]) => unknown;

/** One app process on the wire. */
export class Proc {
  child: ChildProcess;
  ready: Promise<string[]>;
  events: { channel: string; args: unknown[] }[] = [];
  asked: Asked[] = [];
  reply: Reply = () => null;
  private next = 1;
  private waiting = new Map<number, (r: { ok: boolean; value: unknown }) => void>();

  constructor(cmd: string, args: string[], env: Record<string, string>) {
    this.child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr!.on('data', () => {});
    let readyFn: (c: string[]) => void = () => {};
    this.ready = new Promise((r) => { readyFn = r; });
    readline.createInterface({ input: this.child.stdout! }).on('line', (line) => {
      if (!line.startsWith(MARK)) return;
      const body = line.slice(MARK.length);
      const r = /^R (\d+) ([jbe]) (.*)$/s.exec(body);
      if (r) {
        const w = this.waiting.get(Number(r[1]));
        this.waiting.delete(Number(r[1]));
        w?.(r[2] === 'e' ? { ok: false, value: JSON.parse(r[3]) } : { ok: true, value: JSON.parse(r[3]) });
        return;
      }
      const msg = JSON.parse(body);
      if (msg.t === 'ready') readyFn(msg.channels);
      else if (msg.t === 'event') this.events.push({ channel: msg.channel, args: msg.args });
      else if (msg.t === 'request') {
        // what only the window's own process is asked (its look, its zoom) is the shell's business
        if (!/^win\./.test(msg.method)) this.asked.push({ method: msg.method, args: msg.args });
        let value: unknown;
        let ok = true;
        try { value = this.reply(msg.method, msg.args); } catch (e) { ok = false; value = String((e as Error).message); }
        this.child.stdin!.write(`${JSON.stringify(ok ? { t: 'reply', id: msg.id, ok, value: value ?? null } : { t: 'reply', id: msg.id, ok, error: value })}\n`);
      }
    });
  }

  invoke(channel: string, args: unknown[] = []): Promise<{ ok: boolean; value: unknown }> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.child.stdin!.write(`${JSON.stringify({ t: 'invoke', id, channel, args })}\n`);
    });
  }

  async stop(): Promise<void> {
    const done = new Promise((r) => this.child.once('exit', r));
    this.child.stdin!.end();
    setTimeout(() => this.child.kill(), 3000).unref();
    await done;
  }
}

/** One copy: the game, userData, and the folder the process is held to. */
export type Twin = { root: string; game: string; ud: string };

export const twinAt = (root: string): Twin => ({ root, game: path.join(root, 'game'), ud: path.join(root, 'ud') });

/** A state to start both from: the sandbox's game and a userData with these settings. */
export function baseState(dir: string, settings: Record<string, unknown> = {}): Twin {
  const b = twinAt(dir);
  fs.cpSync(SANDBOX_GAME, b.game, { recursive: true });
  fs.mkdirSync(b.ud, { recursive: true });
  fs.writeFileSync(path.join(b.ud, 'settings.json'), JSON.stringify({ dotaGamePath: b.game, ...settings }, null, 2));
  return b;
}

/** Two copies of `base`, each with its own game path written into its settings. */
export function twins(base: Twin, at: string): [Twin, Twin] {
  const out = ['ts', 'rs'].map((side) => {
    const t = twinAt(path.join(at, side));
    fs.cpSync(base.root, t.root, { recursive: true });
    const sf = path.join(t.ud, 'settings.json');
    if (fs.existsSync(sf)) {
      const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
      if (s.dotaGamePath === base.game) s.dotaGamePath = t.game;
      fs.writeFileSync(sf, JSON.stringify(s, null, 2));
    }
    return t;
  });
  return out as [Twin, Twin];
}

export function startTs(t: Twin): Proc {
  return new Proc(process.execPath, [path.join(ROOT, 'src-tauri', 'host', 'host.ts'), `--write-jail=${t.root}`],
    { MM_USER_DATA: t.ud, MM_QUIET: '1', MM_SHELL: 'tauri', MM_APP_VERSION: '9.9.9' });
}

export function startRs(t: Twin): Proc {
  return new Proc(CLI, ['owner', `--user-data-dir=${t.ud}`, `--write-jail=${t.root}`], { MM_APP_VERSION: '9.9.9' });
}

/** Every path of a twin written as <ROOT>, so the two copies' answers can be compared. */
export function blind(v: unknown, t: Twin): unknown {
  const forms = [t.root, t.root.split(path.sep).join('/'), JSON.stringify(t.root).slice(1, -1)];
  const text = JSON.stringify(v ?? null);
  let out = text;
  for (const f of forms) out = out.split(f).join('<ROOT>');
  // a moment read off the clock (ms since 1970, 2020 to 2040) differs by the milliseconds between
  // the two processes, so it is compared as being one, not by its value; a generated record's
  // `code` is the stamp of whichever code built it, which is the one thing the two must not share
  return JSON.parse(out, function (k, x) {
    if (typeof x === 'number' && x > 1.577e12 && x < 2.209e12) return '<TIME>';
    if (k === 'code' && typeof x === 'string' && (this as Record<string, unknown>).set) return '<CODE>';
    return x;
  });
}

/** sha1 of every file under a folder, by its path inside. */
export function tree(dir: string): Record<string, string> {
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries((fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[]).filter((e) => e.isFile())
    .map((e) => {
      const f = path.join(e.parentPath, e.name);
      let data: Buffer | string = fs.readFileSync(f);
      // the ownership note says when it was written: the moment differs, the list must not
      if (e.name === 'dota2modmanager.json') data = JSON.stringify({ ...JSON.parse(data.toString('utf8')), updated: '<TIME>' });
      return [path.relative(dir, f), createHash('sha1').update(data).digest('hex')];
    })
    .sort(([a], [b]) => (a < b ? -1 : 1)));
}

export const readJson = (f: string): unknown => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);

export const tmpRoot = (name: string): string => fs.mkdtempSync(path.join(os.tmpdir(), `mm-owner-${name}-`));

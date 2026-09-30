// "Playing Dota 2 Mod Manager" in Discord, via Discord's local IPC socket.
//
// No OAuth and no account here: presence only needs the application id, which is what
// names the activity. Discord exposes a named pipe (a unix socket elsewhere) and speaks a
// tiny framed protocol — [opcode u32][length u32][json] — so this talks to it directly
// rather than pulling in discord-rpc, which is unmaintained and would be the heaviest
// dependency in the project for about a hundred lines of work.
//
// Everything here is best-effort by design: Discord not running, a user who closed it
// mid-session, a rejected payload — none of it may disturb the app. The worst outcome
// allowed is "no status shown".
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const RETRY_MS = 30_000;      // Discord is usually just not running yet
const MIN_UPDATE_MS = 4_000;  // Discord rate-limits SET_ACTIVITY to ~5 per 20s
const MAX_PIPE = 10;          // discord-ipc-0 … discord-ipc-9

// Discord listens on the first free slot, so the client may sit on any of them.
// MM_DISCORD_PIPE pins a single path instead — for testing against a stand-in socket
// without touching the Discord the developer actually has running.
function socketPath(i: number): string {
  if (process.env.MM_DISCORD_PIPE) return process.env.MM_DISCORD_PIPE;
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || os.tmpdir();
  return path.join(base, `discord-ipc-${i}`);
}

function encode(op: number, data: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(data), 'utf-8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

/** What Discord shows: two lines of text and up to two buttons. */
export interface Activity {
  details?: string;
  state?: string;
  buttons?: { label: string; url: string }[];
}

/** A frame Discord sends back: an event, and whatever it says about it. */
interface Frame { evt?: string; data?: unknown; [key: string]: unknown }

export class DiscordPresence {
  clientId: string;
  diag: (msg: string) => void;
  socket: net.Socket | null;
  ready: boolean;
  enabled: boolean;
  buffer: Buffer;
  /** the latest activity Discord should show */
  activity: Activity | null;
  sentAt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  /** set if Discord ever rejects a payload carrying buttons */
  dropButtons: boolean;

  /** @param opts.clientId  Discord application id (public) */
  constructor({ clientId, onDiag }: { clientId: string; onDiag?: (msg: string) => void }) {
    this.clientId = clientId;
    this.diag = onDiag || (() => {});
    this.socket = null;
    this.ready = false;
    this.enabled = false;
    this.buffer = Buffer.alloc(0);
    this.activity = null;
    this.sentAt = 0;
    this.retryTimer = null;
    this.flushTimer = null;
    this.startedAt = Date.now();
    this.dropButtons = false;
  }

  start(): void {
    if (!this.clientId || this.enabled) return;
    this.enabled = true;
    this.connect(0);
  }

  stop(): void {
    this.enabled = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.retryTimer = this.flushTimer = null;
    this.teardown();
  }

  teardown(): void {
    this.ready = false;
    this.buffer = Buffer.alloc(0);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }

  retry(): void {
    if (!this.enabled || this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(0); }, RETRY_MS);
  }

  // Walk the pipes until one accepts us; if none does, Discord isn't running — try later.
  connect(index: number): void {
    if (!this.enabled) return;
    if (index >= MAX_PIPE) { this.retry(); return; }
    this.teardown();

    const sock = net.createConnection(socketPath(index));
    sock.on('error', () => { sock.destroy(); this.connect(index + 1); });
    sock.on('connect', () => {
      this.socket = sock;
      sock.removeAllListeners('error');
      sock.on('error', () => this.onDisconnect());
      sock.on('close', () => this.onDisconnect());
      sock.on('data', (chunk) => this.onData(chunk));
      sock.write(encode(OP_HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
  }

  onDisconnect(): void {
    if (!this.enabled) return;
    this.teardown();
    this.retry();
  }

  onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 8) return;
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (len < 0 || this.buffer.length < 8 + len) return;
      const body = this.buffer.subarray(8, 8 + len).toString('utf-8');
      this.buffer = this.buffer.subarray(8 + len);
      let msg: Frame | null = null;
      try { msg = JSON.parse(body); } catch { /* not our business */ }
      this.onFrame(op, msg);
    }
  }

  onFrame(op: number, msg: Frame | null): void {
    if (op === OP_PING) { this.socket?.write(encode(OP_PONG, msg)); return; }
    if (op === OP_CLOSE) { this.onDisconnect(); return; }
    if (op !== OP_FRAME || !msg) return;

    if (msg.evt === 'READY') {
      this.ready = true;
      this.diag('discord presence: connected');
      this.push();
      return;
    }
    // A rejected activity is usually the buttons array; drop them and try once more so a
    // status still appears instead of silently never showing up.
    if (msg.evt === 'ERROR') {
      this.diag('discord presence: ' + JSON.stringify(msg.data || {}));
      if (!this.dropButtons) { this.dropButtons = true; this.sentAt = 0; this.push(); }
    }
  }

  /**
   * What Discord should display. Coalesced: callers may fire this on every view change.
   */
  set(activity: Activity): void {
    this.activity = activity;
    this.push();
  }

  push(): void {
    if (!this.ready || !this.socket || !this.activity) return;
    const wait = MIN_UPDATE_MS - (Date.now() - this.sentAt);
    if (wait > 0) {
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => { this.flushTimer = null; this.push(); }, wait);
      }
      return;
    }
    this.sentAt = Date.now();

    const a = this.activity;
    const activity: { type: number; details?: string; state?: string; timestamps: { start: number }; buttons?: Activity['buttons'] } = {
      type: 0, // "Playing"
      details: a.details || undefined,
      state: a.state || undefined,
      timestamps: { start: this.startedAt },
      // No `assets`: naming an art key that was never uploaded makes Discord draw a broken
      // placeholder, while sending none at all makes it fall back to the application icon.
    };
    if (a.buttons && a.buttons.length && !this.dropButtons) activity.buttons = a.buttons.slice(0, 2);

    try {
      this.socket.write(encode(OP_FRAME, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity },
        nonce: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      }));
    } catch {
      this.onDisconnect();
    }
  }
}


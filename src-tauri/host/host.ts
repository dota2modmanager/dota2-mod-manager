/* The TypeScript main process, run under plain Node behind the Tauri shell while it moves to Rust.
 *
 * The Rust side (src-tauri/src/sidecar.rs) answers the channels it already owns and hands every
 * other one to this process over stdin/stdout. Nothing under src/ knows: it asks for Electron
 * through src/electron.ts on each use, and here that call gets the stand-in below. So src/main.ts
 * runs exactly as it does in Electron, registers every channel through ipcMain, and opens a
 * "window" that is only a handle: what it sends goes to the real window through Rust.
 *
 * Wire format, one JSON object per line, every line this process writes starting with MARK
 * (anything else on stdout is a library's console output, and Rust drops it):
 *   Rust -> host  {t:'invoke', id, channel, args}   answer with a line `R <id> j|b|e <json>` (writeResult)
 *                 {t:'send', channel, args}         ipcRenderer.send, no answer
 *                 {t:'reply', id, ok, value|error}  the answer to one of the host's requests
 *                 {t:'loaded'}                      the page finished loading
 *   host -> Rust  {t:'event', channel, args}        webContents.send
 *                 {t:'request', id, method, args}   something only the shell can do: a dialog, a link
 *                 {t:'ready', channels}             every channel registered, the window may load
 * Bytes travel as {$b64: '...'} in both directions (wire.ts).
 *
 * This file goes away with the last channel moved: docs/rust-migration.md keeps the count.
 */
import Module from 'node:module';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';

import { decode, encode } from './wire.ts';
import { makeNativeImage } from './images.ts';

const MARK = '\u0001MM ';
const appRoot = path.resolve(import.meta.dirname, '..', '..');
const env = process.env;

// Library output must not land on the protocol stream.
for (const name of ['log', 'info', 'debug'] as const) console[name] = (...a: unknown[]) => console.error(...a);

function write(msg: Record<string, unknown>): void {
  process.stdout.write(MARK + JSON.stringify(encode(msg)) + '\n');
}

/** An invoke's answer, on a line Rust hands to the window without parsing what is in it:
 * `R <id> j <json>` (no bytes inside), `R <id> b <json>` (bytes as {$b64}), `R <id> e <message>`. */
function writeResult(id: number, ok: boolean, value: unknown): void {
  if (!ok) { process.stdout.write(`${MARK}R ${id} e ${JSON.stringify(String(value))}\n`); return; }
  const seen = { bytes: false };
  const json = JSON.stringify(encode(value === undefined ? null : value, seen)) ?? 'null';
  process.stdout.write(`${MARK}R ${id} ${seen.bytes ? 'b' : 'j'} ${json}\n`);
}

/* ---- requests to the shell ---- */

let nextId = 1;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** Ask the Rust side for something only the shell can do, and wait for its answer. */
function request(method: string, ...args: unknown[]): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    write({ t: 'request', id, method, args });
  });
}
const fireAndForget = (method: string, ...args: unknown[]) => { request(method, ...args).catch(() => {}); };

/* ---- the Electron stand-in ---- */

/** Anything the stand-in does not model: callable, constructible, and every property another of it. */
function inert(): any {
  const fn = function () { return inert(); };
  return new Proxy(fn, {
    get: (_t, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : inert()),
    apply: () => inert(),
    construct: () => inert(),
  });
}
/** An object whose missing members are inert rather than undefined. */
function lenient<T extends object>(known: T): T {
  return new Proxy(known, { get: (t, key) => (key in t ? (t as any)[key] : key === 'then' ? undefined : inert()) });
}

const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
const listeners = new Map<string, (e: unknown, ...a: unknown[]) => void>();

const pageUrl = pathToFileURL(path.join(appRoot, 'out', 'renderer', 'index.html')).href;
const senderFrame = { url: pageUrl, parent: null };

const ipcMain = {
  handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => unknown) => { handlers.set(channel, fn); },
  removeHandler: (channel: string) => { handlers.delete(channel); },
  on: (channel: string, fn: (e: unknown, ...a: unknown[]) => void) => { listeners.set(channel, fn); return ipcMain; },
};

const userData = env.MM_USER_DATA || path.join(env.APPDATA || path.join(os.homedir(), '.config'), 'Dota 2 Mod Manager');
const paths: Record<string, string> = {
  userData,
  appData: path.dirname(userData),
  home: os.homedir(),
  temp: os.tmpdir(),
  downloads: path.join(os.homedir(), 'Downloads'),
  desktop: path.join(os.homedir(), 'Desktop'),
  documents: path.join(os.homedir(), 'Documents'),
  logs: path.join(userData, 'logs'),
  exe: process.execPath,
};

const appEvents = new EventEmitter();
let readyResolve: () => void = () => {};
const ready = new Promise<void>((r) => { readyResolve = r; });

const app = lenient({
  isPackaged: env.MM_PACKAGED === '1',
  getPath: (name: string) => paths[name] ?? userData,
  setPath: (name: string, value: string) => { paths[name] = value; },
  getAppPath: () => appRoot,
  getVersion: () => env.MM_APP_VERSION || '0.0.0',
  getName: () => 'Dota 2 Mod Manager',
  getLocale: () => env.MM_LOCALE || 'en-US',
  getPreferredSystemLanguages: () => (env.MM_LOCALE ? [env.MM_LOCALE] : ['en-US']),
  requestSingleInstanceLock: () => true, // the shell holds the lock (tauri-plugin-single-instance)
  whenReady: () => ready,
  isReady: () => true,
  on: (name: string, fn: (...a: any[]) => void) => { appEvents.on(name, fn); return app; },
  once: (name: string, fn: (...a: any[]) => void) => { appEvents.once(name, fn); return app; },
  quit: () => fireAndForget('app.quit'),
  exit: (code = 0) => { fireAndForget('app.exit', code); setTimeout(() => process.exit(code), 200); },
  relaunch: () => fireAndForget('app.relaunch'),
  setAsDefaultProtocolClient: () => true,
  setLoginItemSettings: () => {},
  getLoginItemSettings: () => ({ openAtLogin: false }),
  getGPUFeatureStatus: () => ({}),
  getGPUInfo: async () => ({}),
});

/** The window as main.ts holds it: a handle whose messages reach the real one through Rust. */
class WebContentsHandle extends EventEmitter {
  id = 1;
  send(channel: string, ...args: unknown[]) { write({ t: 'event', channel, args }); }
  getURL() { return pageUrl; }
  isDestroyed() { return false; }
  isCrashed() { return false; }
  isLoading() { return false; }
  getZoomFactor() { return 1; }
  setZoomFactor() {}
  setWindowOpenHandler() {}
  reload() { fireAndForget('win.reload'); }
  executeJavaScript(js: string) { return request('win.eval', js); }
  capturePage() { return request('win.capture').then((png) => nativeImage.createFromBuffer(png)); }
  sendInputEvent() {}
  openDevTools() { fireAndForget('win.devtools'); }
}
class WindowHandle extends EventEmitter {
  static all: WindowHandle[] = [];
  static getAllWindows() { return WindowHandle.all; }
  static getFocusedWindow() { return WindowHandle.all[0] ?? null; }
  webContents = new WebContentsHandle();
  id = 1;
  constructor(_opts?: unknown) { super(); WindowHandle.all.push(this); }
  loadURL() { return Promise.resolve(); }
  loadFile() { return Promise.resolve(); }
  isDestroyed() { return false; }
  isVisible() { return true; }
  isMinimized() { return false; }
  isMaximized() { return false; }
  isFocused() { return true; }
  show() { fireAndForget('win.show'); }
  hide() { fireAndForget('win.hide'); }
  focus() { fireAndForget('win.focus'); }
  restore() { fireAndForget('win.show'); }
  minimize() { fireAndForget('win.minimize'); }
  maximize() { fireAndForget('win.maximize'); }
  unmaximize() { fireAndForget('win.unmaximize'); }
  close() { fireAndForget('win.close'); }
  destroy() {}
  setTitle() {}
  setProgressBar(p: number) { fireAndForget('win.progress', p); }
  flashFrame() {}
  getBounds() { return { x: 0, y: 0, width: 1280, height: 800 }; }
  setBounds() {}
  getContentSize() { return [1280, 800]; }
}

/** Pictures without Chromium (images.ts). */
const nativeImage = makeNativeImage(lenient);

const dialog = lenient({
  showOpenDialog: (_win: unknown, opts?: unknown) => request('dialog.open', opts ?? _win),
  showSaveDialog: (_win: unknown, opts?: unknown) => request('dialog.save', opts ?? _win),
  showMessageBox: (_win: unknown, opts?: unknown) => request('dialog.message', opts ?? _win),
  showErrorBox: (title: string, content: string) => fireAndForget('dialog.error', title, content),
});
const shell = lenient({
  openExternal: (url: string) => request('shell.openExternal', url),
  openPath: (p: string) => request('shell.openPath', p).then(() => ''),
  showItemInFolder: (p: string) => fireAndForget('shell.showItemInFolder', p),
  trashItem: (p: string) => request('shell.trashItem', p),
  beep: () => {},
});
const clipboard = lenient({
  writeText: (text: string) => fireAndForget('clipboard.writeText', text),
  readText: () => '',
});
const screen = lenient({
  getPrimaryDisplay: () => ({ workAreaSize: { width: Number(env.MM_WORK_W) || 1920, height: Number(env.MM_WORK_H) || 1040 }, scaleFactor: 1 }),
  getAllDisplays: () => [screen.getPrimaryDisplay()],
});
const net = lenient({ fetch: (input: any, init?: any) => fetch(input, init) });
const session = lenient({ defaultSession: inert() });
const protocol = lenient({ registerSchemesAsPrivileged: () => {}, handle: () => {} });

const fakeElectron = lenient({
  app, ipcMain, BrowserWindow: WindowHandle, dialog, shell, clipboard, screen, net, session, protocol, nativeImage,
  Tray: class { constructor() { return inert(); } }, Menu: lenient({ buildFromTemplate: () => inert(), setApplicationMenu: () => {} }),
  powerSaveBlocker: lenient({ start: () => 0, stop: () => {} }),
  webContents: lenient({ getAllWebContents: () => WindowHandle.all.map((w) => w.webContents) }),
});

type Loader = { _load: (this: unknown, request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const realLoad = loader._load;
loader._load = function stubbed(req, ...rest) {
  return req === 'electron' ? fakeElectron : realLoad.call(this, req, ...rest);
};

/* ---- the stream from Rust ---- */

/** MM_TRACE=1: each answer's time on stderr, the work apart from the sending */
const TRACE = process.env.MM_TRACE === '1';

async function answer(id: number, channel: string, args: unknown[]): Promise<void> {
  const fn = handlers.get(channel);
  if (!fn) { writeResult(id, false, `no handler for ${channel}`); return; }
  try {
    const t0 = TRACE ? performance.now() : 0;
    const value = await fn({ sender: WindowHandle.all[0]?.webContents, senderFrame }, ...args);
    const t1 = TRACE ? performance.now() : 0;
    writeResult(id, true, value);
    if (TRACE) process.stderr.write(`[mm-host] ${channel}: ${(t1 - t0).toFixed(0)} ms, sent in ${(performance.now() - t1).toFixed(0)} ms\n`);
  } catch (err) {
    writeResult(id, false, String((err as Error)?.message ?? err));
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg: any;
  try { msg = decode(JSON.parse(line)); } catch { return; }
  if (msg.t === 'invoke') void answer(msg.id, msg.channel, msg.args ?? []);
  else if (msg.t === 'send') { try { listeners.get(msg.channel)?.({ senderFrame }, ...(msg.args ?? [])); } catch (err) { console.error(err); } }
  else if (msg.t === 'reply') {
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.ok) w.resolve(msg.value); else w.reject(new Error(String(msg.error)));
  } else if (msg.t === 'loaded') {
    for (const w of WindowHandle.all) w.webContents.emit('did-finish-load');
  } else if (msg.t === 'key') {
    // Ctrl +/-/0 in the page: src/main-window.ts scales the content from here, as in Electron
    for (const w of WindowHandle.all) w.webContents.emit('before-input-event', { preventDefault() {} }, msg.input);
  } else if (msg.t === 'quit') {
    appEvents.emit('before-quit', { preventDefault() {} });
    appEvents.emit('will-quit', { preventDefault() {} });
    setTimeout(() => process.exit(0), 300);
  }
});
process.stdin.on('end', () => process.exit(0));

/* ---- start ---- */

await import(pathToFileURL(path.join(appRoot, 'src', 'main.ts')).href);
readyResolve();
// main.ts registers every channel inside start(), after whenReady; wait for the window it opens
const started = Date.now();
const announce = setInterval(() => {
  if (WindowHandle.all.length || Date.now() - started > 60_000) {
    clearInterval(announce);
    write({ t: 'ready', channels: [...handlers.keys(), ...listeners.keys()] });
  }
}, 20);

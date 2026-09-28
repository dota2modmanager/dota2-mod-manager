/* The app's own channels (src/ipc-window.js, ipc-settings.js, ipc-misc.js, ipc-diagnostics.js,
 * main.js): the window, settings, the zoom, the game's launch, the account and the beta channel,
 * Discord presence, small errands, the diagnostics report and updates. */
import type { Dialog, Reply } from './reply.ts';

/** What the window calls settings: the stored values plus a few facts only main can answer (src/settings-view.js). */
export type AppSettings = Record<string, any>;

export interface WinApi {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximized: (cb: (maximized: boolean) => void) => void;
}

export interface SettingsApi {
  get: () => Promise<AppSettings>;
  set: (key: string, value: unknown) => Promise<AppSettings>;
  /** the folder found, or a falsy answer when there is none */
  detectDota: () => Promise<string | null | false>;
  browseDota: () => Promise<{ path?: string; error?: string; cancelled?: boolean } | null>;
  moveLangFiles: (fromSuffix: string | undefined) => Promise<Reply<{ moved: number; to: string }>>;
}

export interface UiApi {
  setZoom: (factor: number) => Promise<Reply<{ uiScale: number }>>;
  onZoom: (cb: (factor: number) => void) => void;
}

export interface MiscApi {
  openLangFolder: () => Promise<Reply>;
  openToolsFolder: (sub?: string) => Promise<Reply>;
  openExternal: (url: string | undefined) => Promise<Reply>;
  cacheSize: () => Promise<number>;
  clearCache: () => Promise<Reply>;
  runTool: (dirName: string) => Promise<Reply>;
}

export interface UpdateApi {
  install: () => Promise<void>;
  fetchPortable: () => Promise<Reply<{ name: string; path: string; already: boolean }>>;
  revealPortable: (p: string) => Promise<Reply>;
  version: () => Promise<string>;
  notes: (lang: string) => Promise<{ version: string; notes: string; unseen: boolean }>;
  notesSeen: () => Promise<Reply>;
  onUpdate: (cb: (evt: Record<string, any>) => void) => void;
}

export interface AppApi {
  win: WinApi;
  settings: SettingsApi;
  ui: UiApi;
  game: { launch: () => Promise<Reply> };
  account: { signIn: () => Promise<Reply<{ account: Record<string, any> }>>; signOut: () => Promise<Reply> };
  /** the beta channel: shown only to an account the signed list names (src/beta.js) */
  beta: { state: () => Promise<{ eligible: boolean; on: boolean }>; set: (on: boolean) => Promise<{ eligible: boolean; on: boolean }> };
  presence: { view: (name: string) => Promise<void> };
  misc: MiscApi;
  diag: { export: () => Promise<Dialog<{ path: string }>>; reportError: (msg: string) => void };
  onProgress: (cb: (evt: Record<string, any>) => void) => void;
  update: UpdateApi;
}

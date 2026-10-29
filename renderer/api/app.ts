/* The app's own channels (src/ipc-window.ts, ipc-settings.ts, ipc-misc.ts, ipc-diagnostics.ts,
 * src/main.ts): the window, settings, the zoom, the game's launch, the account and the beta channel,
 * Discord presence, small errands, the diagnostics report and updates. */
import type { Dialog, Reply } from './reply.ts';
import type { MinifyState } from '../core/minify-notice.ts';
import type { Panels } from '../core/constants.ts';

/** What settings.json holds (src/settings.ts DEFAULTS, and the few keys main adds later). */
export interface StoredSettings {
  dotaGamePath: string | null;
  langSuffix: string;
  uiLang: 'en' | 'ru' | 'zh-CN';
  langPromptSeen: boolean;
  uiScale: number;
  theme: string;
  /** starred catalog mods, as "<categoryId>|<name>" */
  favorites: string[];
  /** read through ui/chrome.ts readPanels, which fills in and clamps whatever is missing */
  panels: Partial<Panels> | null;
  account: { id: string; username: string; avatar?: string | null } | null;
  discordPresence: boolean;
  /** installs of catalog mods are counted by the catalog's download counter (src/download-stats.ts) */
  countDownloads: boolean;
  schemaPatch: boolean;
  cosmetics: Record<string, unknown>;
  schemaStamp: string | null;
  toolsPromptSeen: boolean;
  /** null until the one question about adult mods is answered (core/adult.ts) */
  showAdult: boolean | null;
  lastSeenVersion: string | null;
  downloadProxy: string;
  betaChannel?: boolean;
  seenNotices?: string[];
  slotZones?: unknown;
  gameStamp?: unknown;
  /** the pumpkin in the title bar has come out (ui/pumpkin.ts) */
  pumpkin?: boolean;
  /** the ninth theme is open (ui/pumpkin.ts) */
  secret?: boolean;
  /** the pumpkin has been fed a spider and is lit, waiting for a key (ui/pumpkin.ts) */
  pumpkinLit?: boolean;
  /** a key was spent: the bloody night is open (src/pumpkin.ts) */
  blood?: boolean;
}

/** What main reports while it works, for the bar over the status bar (shell/progress.ts): bytes
 *  of a download, a batch counted in items, a named step, and the end either way. */
type ProgressEvent =
  | { type: 'download'; label: string; loaded: number; total: number }
  | { type: 'count'; label: string; done: number; total: number }
  | { type: 'stage'; label: string; stage: string }
  | { type: 'done'; label?: string }
  | { type: 'error'; label: string; message: string };

/** A new version of the app (src/updater.ts): found, to fetch beside a portable copy, or ready. */
type UpdateEvent = { type: 'available' | 'portable' | 'downloaded'; version: string };

/** What the window calls settings: the stored values plus a few facts only main can answer (src/settings-view.ts). */
export interface AppSettings extends StoredSettings {
  dotaPathValid: boolean;
  minify: MinifyState | null;
  discordConfigured: boolean;
  gameLang: {
    /** the language folder the game mounts, when it could be read */
    mounted: string | null;
    /** a -language in Steam's launch options, which overrules everything */
    launchLang: string | null;
    folder: string;
    /** our mods left in a folder the game does not mount */
    stranded: { suffix: string; modFiles: number }[];
  };
  /** news, once: the mods moved to another language folder on this start */
  langMigration: { from?: string; to: string } | null;
  /** news, once: the load order was laid out in its two parts on this start */
  slotMigration: unknown;
}

interface WinApi {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximized: (cb: (maximized: boolean) => void) => void;
}

interface SettingsApi {
  get: () => Promise<AppSettings>;
  set: <K extends keyof StoredSettings>(key: K, value: StoredSettings[K]) => Promise<AppSettings>;
  /** the folder found, or a falsy answer when there is none */
  detectDota: () => Promise<string | null | false>;
  browseDota: () => Promise<{ path?: string; error?: string; cancelled?: boolean } | null>;
  moveLangFiles: (fromSuffix: string | undefined) => Promise<Reply<{ moved: number; to: string }>>;
  testProxy: (proxy: string) => Promise<Reply>;
}

interface UiApi {
  setZoom: (factor: number) => Promise<Reply<{ uiScale: number }>>;
  onZoom: (cb: (factor: number) => void) => void;
}

interface MiscApi {
  openLangFolder: () => Promise<Reply>;
  openToolsFolder: (sub?: string) => Promise<Reply>;
  openExternal: (url: string | undefined) => Promise<Reply>;
  cacheSize: () => Promise<number>;
  clearCache: () => Promise<Reply>;
  runTool: (dirName: string) => Promise<Reply>;
}

/** What spending a key came to (src/pumpkin.ts RedeemAnswer). */
export type RedeemAnswer =
  | { ok: true; installed: string | null; installError?: string }
  | { error: 'empty' | 'wrong' | 'used' | 'offline' | 'broken'; detail?: string };

interface PumpkinApi {
  redeem: (key: string) => Promise<RedeemAnswer>;
  prizeAgain: () => Promise<{ ok: true; installed: string } | { error: string }>;
  hasPrize: () => Promise<boolean>;
}

interface UpdateApi {
  install: () => Promise<void>;
  fetchPortable: () => Promise<Reply<{ name: string; path: string; already: boolean }>>;
  revealPortable: (p: string) => Promise<Reply>;
  version: () => Promise<string>;
  notes: (lang: string) => Promise<{ version: string; notes: string; unseen: boolean }>;
  notesSeen: () => Promise<Reply>;
  onUpdate: (cb: (evt: UpdateEvent) => void) => void;
}

export interface AppApi {
  win: WinApi;
  settings: SettingsApi;
  ui: UiApi;
  game: { launch: () => Promise<Reply> };
  account: { signIn: () => Promise<Reply<{ account: NonNullable<StoredSettings['account']> }>>; signOut: () => Promise<Reply> };
  /** the beta channel: shown only to an account the signed list names (src/beta.ts) */
  beta: { state: () => Promise<{ eligible: boolean; on: boolean }>; set: (on: boolean) => Promise<{ eligible: boolean; on: boolean }> };
  presence: { view: (name: string) => Promise<void> };
  /** the window asking for support: whether it opens on its own, and the user's answer (src/support-prompt.ts) */
  support: { state: () => Promise<{ due: boolean }>; choose: (choice: 'later' | 'done') => Promise<Reply> };
  misc: MiscApi;
  /** the pumpkin's key: the bloody theme and the mod it opens (src/ipc-pumpkin.ts) */
  pumpkin: PumpkinApi;
  diag: { export: () => Promise<Dialog<{ path: string }>>; reportError: (msg: string) => void };
  onProgress: (cb: (evt: ProgressEvent) => void) => void;
  update: UpdateApi;
}

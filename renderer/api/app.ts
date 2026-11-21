/* The app's own channels (crates/mm-core/src/owner/owner_app.rs, owner_settings.rs and their
 * neighbours): the window, settings, the zoom, the game's launch, the account and the beta channel,
 * Discord presence, small errands, the diagnostics report and updates. */
import type { Dialog, Reply } from './reply.ts';
import type { MinifyState } from '../core/minify-notice.ts';
import type { Panels } from '../core/constants.ts';
import type { ItemLook } from '../catalog/types.ts';

/** What settings.json holds (crates/mm-core/src/app/settings.rs DEFAULTS, and the few keys main adds later). */
export interface StoredSettings {
  dotaGamePath: string | null;
  langSuffix: string;
  /** the mods folder kept whatever the game is set to, or null to follow the game (crates/mm-core/src/app/settings.rs) */
  langFolderLock?: string | null;
  uiLang: 'en' | 'ru' | 'zh-CN';
  langPromptSeen: boolean;
  /** the hint about Russian voices under English text was waved away */
  russianVoiceSeen?: boolean;
  uiScale: number;
  theme: string;
  /** starred catalog mods, as "<categoryId>|<name>" */
  favorites: string[];
  /** the user's own names for rows in My mods (library/labels.ts) */
  modLabels?: Record<string, string>;
  /** read through ui/chrome.ts readPanels, which fills in and clamps whatever is missing */
  panels: Partial<Panels> | null;
  account: {
    id: string; username: string; avatar?: string | null;
    /** signed in through the catalog's account service: its frame for the server role, and the role's name */
    cloud?: boolean; frame?: string | null; label?: string | null;
  } | null;
  discordPresence: boolean;
  /** start with Windows and hide in the tray on close (crates/mm-core/src/app/tray.rs); on unless false */
  runInBackground?: boolean;
  /** installs of catalog mods are counted by the catalog's download counter (crates/mm-core/src/catalog/download_stats.rs) */
  countDownloads: boolean;
  /** fold mods into the shared pack when the pak slots run out; on unless turned off */
  autoPack?: boolean;
  /** a hero's mod in 3D in its window; off, the window shows the mod's picture as before 4.5 */
  modPreview3d?: boolean;
  /** everybody playing a hero the item builder dressed wears the same look (crates/mm-core/src/item_builder/item_builder_everyone.rs) */
  everyoneWearsMine: boolean;
  /** the hero pictures in the pick grid as Valve drew them, whatever arcana or persona is worn (crates/mm-core/src/schema/stock_portraits.rs) */
  heroPortraitsStock?: boolean;
  /** the heroes it leaves alone, by id: every other hero built is dressed, as the game's limit allows (crates/mm-core/src/item_builder/item_builder_everyone_budget.rs) */
  everyoneExcluded: string[];
  /** the heroes the last build left out to stay under that limit */
  everyoneLeftOut: string[];
  /** each hero's own pedestal on the loadout screen, hero id to model (crates/mm-core/src/item_builder/hero_pedestals.rs) */
  heroPedestals?: Record<string, string>;
  /** each hero's pedestal moved up or down from its feet, in the game's units (-64 to 64) */
  heroPedestalHeights?: Record<string, number>;
  /** without the item table: the game's pedestal hidden for every hero, so the chosen ones stand alone */
  pedestalHideBase?: boolean;
  schemaPatch: boolean;
  cosmetics: Record<string, unknown>;
  /** the item builder's saved looks (views/item-looks.ts) */
  itemLooks: ItemLook[];
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
  /** a key was spent: the bloody night is open (crates/mm-core/src/looks/pumpkin.rs) */
  blood?: boolean;
}

/** What main reports while it works, for the bar over the status bar (shell/progress.ts): bytes
 *  of a download, a batch counted in items, a named step, and the end either way. */
type ProgressEvent =
  | { type: 'download'; label: string; loaded: number; total: number }
  | { type: 'count'; label: string; done: number; total: number; cancel?: 'schema' }
  | { type: 'stage'; label: string; stage: string }
  | { type: 'done'; label?: string }
  | { type: 'error'; label: string; message: string };

/** A new version of the app (crates/mm-core/src/app/updater.rs): found, to fetch beside a portable copy, or ready. */
type UpdateEvent = { type: 'available' | 'portable' | 'downloaded'; version: string };

/** What the window calls settings: the stored values plus a few facts only main can answer (crates/mm-core/src/app/settings_view.rs). */
export interface AppSettings extends StoredSettings {
  dotaPathValid: boolean;
  /** the heroes the user built with the item builder, picked last first */
  everyoneBuilt: { id: string; name: string }[];
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
    /** the text language in the game's own settings */
    uiLanguage: string | null;
    /** Valve's voice paks are downloaded into our folder */
    voice: boolean;
  };
  /** news, once: the mods moved to another language folder on this start */
  langMigration: { from?: string; to: string } | null;
  /** news, once: the load order was laid out in its two parts on this start */
  slotMigration: unknown;
}

/** The service off (`enabled` false) until the signed remote config names it. Likes are by the
 *  download counter's key (category/group/name), follows by the author's name. */
export interface SocialState {
  enabled: boolean;
  signedIn: boolean;
  likes: string[];
  follows: string[];
  counts: { likes: Record<string, number>; followers: Record<string, number> };
}

/** Which hero grids the app made: the kinds it can make, and what the account's file holds now. */
export type GridKind = 'winrate' | 'attribute' | 'popular';
export interface GridState { account: boolean; kinds: GridKind[]; statsAt: number | null }

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
  openCacheFolder: () => Promise<Reply>;
  openToolsFolder: (sub?: string) => Promise<Reply>;
  openExternal: (url: string | undefined) => Promise<Reply>;
  cacheSize: () => Promise<number>;
  clearCache: () => Promise<Reply>;
  /** Every archive in the download cache, largest first (crates/mm-core/src/install/installer_downloads.rs listDownloadCache). */
  cacheList: () => Promise<Array<{ key: string; categoryId: string; name: string; bytes: number; at: number }>>;
  cacheRemove: (key: string) => Promise<{ ok: boolean }>;
  runTool: (dirName: string) => Promise<Reply>;
}

/** What spending a key came to (crates/mm-core/src/looks/pumpkin.rs). */
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
  /** the project's GitHub stars, null when it could not be had (crates/mm-core/src/app/app_info.rs) */
  stars: () => Promise<number | null>;
  onUpdate: (cb: (evt: UpdateEvent) => void) => void;
}

export interface AppApi {
  win: WinApi;
  settings: SettingsApi;
  ui: UiApi;
  /** warning: Steam is still updating the game (crates/mm-core/src/game/steam_appstate.rs), said before it starts */
  game: {
    launch: () => Promise<Reply<{ warning?: string | null }>>; steamDownloads: () => Promise<Reply>; steamProperties: () => Promise<Reply>;
    /** Dota opened or closed; while it is open the channels that write the game answer with `gameOpen` */
    onRunning: (cb: (running: boolean) => void) => void;
    /** Dota closed seconds after Play, with the enabled mods installed since it last ran normally (crates/mm-core/src/game/game_watch.rs) */
    onQuickExit: (cb: (exit: { seconds: number; suspects: { id: string; name: string }[] }) => void) => void;
  };
  account: { signIn: () => Promise<Reply<{ account: NonNullable<StoredSettings['account']> }>>; signOut: () => Promise<Reply> };
  /** likes on mods and follows of authors, kept by the catalog's account service (crates/mm-core/src/catalog/social.rs) */
  social: {
    state: () => Promise<SocialState>;
    mark: (kind: 'like' | 'follow', name: string, on: boolean) => Promise<Reply<{ on: boolean; count: number }>>;
  };
  /** the beta channel: shown only to an account the signed list names (crates/mm-core/src/catalog/beta.rs) */
  beta: { state: () => Promise<{ eligible: boolean; on: boolean }>; set: (on: boolean) => Promise<{ eligible: boolean; on: boolean }> };
  presence: { view: (name: string) => Promise<void> };
  /** the window asking for support: whether it opens on its own, and the user's answer (crates/mm-core/src/app/support_prompt.rs) */
  support: { state: () => Promise<{ due: boolean }>; choose: (choice: 'later' | 'done') => Promise<Reply> };
  misc: MiscApi;
  /** the pumpkin's key: the bloody theme and the mod it opens (crates/mm-core/src/owner/owner_studios.rs) */
  pumpkin: PumpkinApi;
  /** hero grids for the pick screen, written into the Steam account's grid file (crates/mm-core/src/game/hero_grid.rs) */
  grids: {
    state: () => Promise<GridState>;
    apply: (kinds: GridKind[]) => Promise<Reply<{ kinds: GridKind[]; statsAt: number }>>;
    remove: () => Promise<Reply<{ kinds: GridKind[] }>>;
  };
  diag: { export: () => Promise<Dialog<{ path: string }>>; reportError: (msg: string) => void };
  onProgress: (cb: (evt: ProgressEvent) => void) => void;
  update: UpdateApi;
}

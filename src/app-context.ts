/* Everything the running app hands its IPC modules: the services main.js builds at start, and the
 * callbacks over its own state.
 *
 * Each src/ipc-*.ts takes a Pick of this, so what a module can reach is written at the top of it.
 * Anything main.js keeps changing while the app runs (the window, the patch watcher, the updater,
 * the folder mods go into) is handed over as a function and read when it is needed: a value would
 * be the one the app had at registration, and answer for the wrong moment from then on.
 */
import type { BrowserWindow } from 'electron';
import type { Settings } from './settings.ts';
import type { Catalog } from './catalog.ts';
import type { Installer, InstallProgress } from './installer.ts';
import type { Library } from './library.ts';
import type { Fingerprints } from './fingerprints.ts';
import type { Icons } from './icons.ts';
import type { DiscordPresence } from './discord-presence.ts';
import type { ToolProgress, createToolchain } from './toolchain.ts';
import type { createSchemaService } from './schema-service.ts';
import type { createGameIcons } from './game-icons.ts';
import type { createModPreviews } from './mod-preview.ts';
import type { createRemoteConfig } from './remote-config.ts';
import type { presetsService } from './presets-service.ts';
import type { createGate } from './feature-gate.ts';
import type { createCursors } from './cursors.ts';
import type { createAdopt } from './adopt.ts';
import type { settingsViewFor } from './settings-view.ts';
import type { createPatchWatcher } from './patch-watch.ts';
import type { createUpdater, UpdaterLike } from './updater.ts';
import type { findDotaGamePath, validateGamePath } from './steam.ts';
import type { moveLangFolder } from './gamelang.ts';
import type { LibRecord } from './types.ts';
import type * as discordAuthModule from './discord-auth.ts';
import type * as portableUpdateModule from './portable-update.ts';

/** Every kind of event the bar at the bottom of the window is sent. */
export type AppProgress =
  | InstallProgress
  | ToolProgress
  | { type: 'count'; label: string; done: number; total: number }
  | { type: 'done'; label?: string }
  | { type: 'error'; label: string; message: string };

/** What the app did about the last Dota patch, shown as a banner in My mods. */
export type PatchRepair = {
  state: 'idle' | 'waiting' | 'done' | 'failed';
  healed?: string[];
  error?: string | null;
  reason?: unknown;
  at?: number;
};

type Cursors = ReturnType<typeof createCursors>;
type Adopt = ReturnType<typeof createAdopt>;
type ImportAnswer = Awaited<ReturnType<Adopt['registerImportResults']>> | { error: string };

export interface AppContext {
  // ---- the services ----
  settings: Settings;
  catalog: Catalog;
  installer: Installer;
  library: Library;
  fingerprints: Fingerprints;
  schemaService: ReturnType<typeof createSchemaService>;
  icons: Icons;
  gameIcons: ReturnType<typeof createGameIcons>;
  modPreviews: ReturnType<typeof createModPreviews>;
  toolchain: ReturnType<typeof createToolchain>;
  remoteConfig: ReturnType<typeof createRemoteConfig>;
  presets: ReturnType<typeof presetsService>;
  presence: DiscordPresence;
  discordAuth: typeof discordAuthModule;
  portableUpdater: typeof portableUpdateModule;
  /** electron-updater, when the packaged build has it */
  autoUpdater: (UpdaterLike & { quitAndInstall(): void }) | null;
  /** the one switch that stops a feature the signed config turned off (src/feature-gate.ts) */
  blocked: ReturnType<typeof createGate>;
  settingsView: ReturnType<typeof settingsViewFor>;

  // ---- what the app does, as main.js does it ----
  diag: (msg: string) => void;
  sendProgress: (evt: AppProgress) => void;
  dotaIsRunning: () => Promise<boolean>;
  refreshPresence: () => void;
  applyPresenceSetting: () => void;
  clampZoom: (v: unknown) => number;
  releaseNotes: (version: string, lang: string) => string | null;
  afterDeployMaster: () => void;
  deployAndApply: (pack: LibRecord) => { key: string; path: string }[];
  repairAfterPatch: (reason?: unknown) => Promise<void>;
  setPatchRepair: (next: PatchRepair) => void;
  setPresenceView: (view: string) => void;
  importVpkPaths: (paths: unknown) => Promise<ImportAnswer>;
  importVpkBuffers: (items: unknown) => Promise<ImportAnswer>;
  adoptImportedFiles: Adopt['adoptImportedFiles'];
  isCursorRecord: Cursors['isCursorRecord'];
  disableOtherCursors: Cursors['disableOtherCursors'];
  disableOtherCosmetics: Cursors['disableOtherCosmetics'];
  applyMasterToCursors: Cursors['applyMasterToCursors'];
  findDotaGamePath: typeof findDotaGamePath;
  validateGamePath: typeof validateGamePath;
  moveLangFolder: typeof moveLangFolder;

  // ---- main.js's own state, read when it is needed ----
  IS_PORTABLE: boolean;
  /** the main window; every channel is called from it, so it is open whenever a handler runs */
  win: () => BrowserWindow;
  langFolder: () => string;
  patchWatcher: () => ReturnType<typeof createPatchWatcher> | null;
  updater: () => ReturnType<typeof createUpdater> | null;
  portableUpdate: () => string | null;
  patchRepair: () => PatchRepair;
  verifyStuck: () => { id: string; name: string }[];
  logFile: () => string;
  rendererErrors: () => unknown[];
  lastUpdateError: () => string | null;
}

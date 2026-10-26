/* The content channels (src/ipc-game.ts, ipc-presets.ts, ipc-settings.ts): the catalog, the item
 * schema and the free cosmetics it enables, the pictures, the Source 2 toolchain, what the network
 * told the app, and presets. */
import type { CatalogData } from '../catalog/data.ts';
import type { CosmeticSet, CosmeticSlot } from '../catalog/types.ts';
import type { LibRecord, RepairState } from '../library/types.ts';
import type { Dialog, Reply } from './reply.ts';

/** One mod of a preset as sharing it would carry it (src/presets-service.ts planShape). */
export interface ShareEntry {
  key: string;
  /** 'catalog' travels as a name, 'embedded' as its bytes, 'missing' cannot travel */
  kind: 'catalog' | 'embedded' | 'missing' | 'cosmetic' | 'pack' | string;
  name: string;
  size: number;
  info: string;
  reason: string;
  slot?: string;
  members?: ShareEntry[];
}

export interface CatalogApi {
  load: (force?: boolean) => Promise<CatalogData & { stale?: boolean; fetchedAt?: number }>;
  /** which whole-map terrains were built for an older map than the game's */
  terrainAges: () => Promise<{ mapAt: number | null; ages: Record<string, number>; stale: Record<string, boolean>; error?: string }>;
  /** a d2mm://mod/ link clicked outside the app: the mod it names, or null when it names none */
  onModLink: (cb: (link: ModLink | null) => void) => void;
}

/** What a d2mm://mod/ link names (src/deep-links.ts parses it). */
export interface ModLink {
  cat: string;
  name: string;
  /** the look's label, when the link picks one */
  style: string | null;
}

/** The schema patch's state: whether our line is in gameinfo, and what else is (src/schema-service.ts). */
export interface PatchState {
  conflicts?: { mods: string[] }[];
  foreign?: string | null;
  vanillaOk?: boolean;
  [key: string]: unknown;
}

export interface PatchApi {
  state: () => Promise<PatchState>;
  setEnabled: (on: boolean) => Promise<Reply>;
  refreshSchema: () => Promise<Reply>;
  /** what was done about the last Dota patch, and the two things the banner can ask for */
  repairState: () => Promise<RepairState>;
  repairNow: () => Promise<RepairState>;
  repairSeen: () => Promise<RepairState>;
  onRepair: (cb: (st: RepairState) => void) => void;
}

/** A tool as src/toolchain.ts state() describes it; `available` is false where this machine has no build of it. */
interface ToolState { name: string; ready: boolean; available: boolean; installedBytes: number; downloadBytes: number; [key: string]: unknown }

export interface ToolsApi {
  state: () => Promise<{ tools: ToolState[]; iconCacheBytes: number }>;
  install: (name: string) => Promise<Reply<{ tools: ToolState[] }>>;
  remove: (name: string) => Promise<Reply<{ tools: ToolState[] }>>;
}

/** resourcecompiler.exe as src/resource-compiler.ts state() describes it. */
export interface CompilerState {
  exe: string | null; chosen: boolean; needsWine: boolean; wine: string | null; prefixReady: boolean; ready: boolean;
  /** the last check of this compiler: an empty model compiled, and how long it took */
  check: { ok: boolean; message?: string; seconds: number; at: number } | null;
  /** which compiler runs: picked in Settings, the game's own, or the copy the app kept */
  source: 'chosen' | 'game' | 'kept' | null;
  /** on Linux, the copy of the Workshop Tools the app keeps for when Steam takes the game's away */
  kept: { from: string; bytes: number; at: number } | null;
  /** whether the game has tools the copy is not of */
  keepable: boolean;
  /** whether a copy is here that is not run, made before it took Dota's own Windows files */
  keptOutdated: boolean;
}

export interface CompilerApi {
  state: () => Promise<CompilerState>;
  /** null when the dialog was closed */
  browse: () => Promise<Reply<{ state: CompilerState }> | null>;
  forget: () => Promise<Reply<{ state: CompilerState }>>;
  /** the state comes back with an error too: what is missing is what Settings shows */
  prepare: () => Promise<Reply<{ state: CompilerState }>>;
  /** compile an empty model; the bar at the bottom counts its steps */
  check: () => Promise<Reply<{ state: CompilerState }>>;
  /** copy the game's Workshop Tools into the app's folder; the bar at the bottom counts the files */
  keep: () => Promise<Reply<{ state: CompilerState }>>;
  removeKept: () => Promise<Reply<{ state: CompilerState }>>;
}

export interface Notice { id: string; date?: string; level?: string; text: string; url?: string }

export interface ConfigApi {
  state: () => Promise<{ features: Record<string, unknown>; notices: Notice[]; seen: string[] }>;
  noticeSeen: (id: string) => Promise<string[]>;
}

export interface CosmeticsApi {
  slots: () => Promise<{ slots: CosmeticSlot[]; sets: CosmeticSet[]; names?: Record<string, string> } & Record<string, unknown>>;
  /** pictures by name; the clips among them come back to be decoded here (ui/cosmetic-icons.ts) */
  icons: (names: string[]) => Promise<{ pictures: Record<string, string | null>; decode: string[] }>;
  heroPortraits: (ids: string[]) => Promise<Record<string, string>>;
  heroPortraitsByName: (names: string[]) => Promise<Record<string, string>>;
  pick: (slot: string, itemId: string, itemName: string, effectId: string) => Promise<Reply<{ record: LibRecord }>>;
  pickSet: (setId: string) => Promise<Reply<{ applied: number; pieces: number }>>;
}

/** The whole arcana, or only its colour over one the player has (src/arcana-service.ts). */
export type ArcanaMode = 'mod' | 'recolor';

/** The arcana built out of the game's own files, in a colour of the user's (src/arcana-service.ts). */
export interface ArcanaApi {
  /** whether the game has the files, the arcana's picture out of it, and the one built before */
  state: () => Promise<Reply<{
    available: boolean;
    picture: string | null;
    installed: { id: string; color: [number, number, number]; mode: ArcanaMode; enabled: boolean } | null;
  }>>;
  /** build it and put it in My mods, in place of the one built before */
  install: (color: [number, number, number], mode: ArcanaMode) => Promise<Reply<{ record: LibRecord }>>;
}

/** A mod's own video, and the still the window decodes out of it. */
export interface PreviewApi {
  video: (key: string) => Promise<Uint8Array | null>;
  /** the frame kept as the mod's picture, as a data URI, or null when it was not worth showing */
  frame: (key: string, png: Uint8Array) => Promise<string | null>;
}

/** A preset as presets:list gives it: the build, with what is and is not installed worked out. */
export interface PresetRecord {
  id: string;
  name: string;
  modIds: string[];
  /** members the build names that are not installed now */
  absent?: { name: string; categoryId?: string }[];
  /** what a link could carry of it */
  link?: { count: number; skipped: unknown[] };
  /** the looks it puts on, slot by slot (src/library.ts picksOn) */
  picks?: { slot: string; itemId: string; name: string; effectId: string }[];
  /** a received preset, waiting to be installed */
  wanted?: unknown;
  source?: { author?: string; note?: string };
  status?: { installed: number; download: number; embedded: number; free?: number; unavailable: string[] };
}

export interface PresetsApi {
  list: () => Promise<PresetRecord[]>;
  /** the stored presets, as saved (their members by identity, not yet resolved) */
  save: (name: string) => Promise<unknown[]>;
  update: (id: string) => Promise<Reply<{ count: number }>>;
  rename: (id: string, name: string) => Promise<Reply<{ name: string }>>;
  delete: (id: string) => Promise<unknown[]>;
  apply: (id: string) => Promise<Reply<{ installed: number; missing: string[]; errors: string[] }>>;
  exportPlan: (id: string) => Promise<Reply<{ name: string; entries: ShareEntry[] }>>;
  exportFile: (id: string, opts: { skip: string[]; author: string; note: string }) => Promise<Dialog<{ path: string; size: number }>>;
  shareLink: (id: string) => Promise<Reply<{ web?: string; count: number; skipped: unknown[] }>>;
  importDialog: () => Promise<Dialog<{ preset: { name: string } }>>;
  importFile: (filePath: string) => Promise<Reply<{ preset: { name: string } }>>;
  resolve: (id: string) => Promise<Reply<{ installed: number; errors: string[] }>>;
  onLink: (cb: (res: unknown) => void) => void;
}

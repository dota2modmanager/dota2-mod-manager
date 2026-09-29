/* The content channels (src/ipc-game.js, ipc-presets.js, ipc-settings.js): the catalog, the item
 * schema and the free cosmetics it enables, the pictures, the Source 2 toolchain, what the network
 * told the app, and presets. */
import type { CatalogData } from '../catalog/data.ts';
import type { CosmeticSet, CosmeticSlot } from '../catalog/types.ts';
import type { LibRecord, RepairState } from '../library/types.ts';
import type { Dialog, Reply } from './reply.ts';

/** One mod of a preset as sharing it would carry it (src/presets-service.js planShape). */
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
}

/** The schema patch's state: whether our line is in gameinfo, and what else is (src/schema-service.js). */
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

export interface ToolState { name: string; ready: boolean; installedBytes: number; downloadBytes: number; [key: string]: unknown }

export interface ToolsApi {
  state: () => Promise<{ tools: ToolState[]; iconCacheBytes: number }>;
  install: (name: string) => Promise<Reply<{ tools: ToolState[] }>>;
  remove: (name: string) => Promise<Reply<{ tools: ToolState[] }>>;
}

export interface Notice { id: string; date?: string; level?: string; text: string; url?: string }

export interface ConfigApi {
  state: () => Promise<{ features: Record<string, unknown>; notices: Notice[]; seen: string[] }>;
  noticeSeen: (id: string) => Promise<string[]>;
}

export interface CosmeticsApi {
  slots: () => Promise<{ slots: CosmeticSlot[]; sets: CosmeticSet[] } & Record<string, unknown>>;
  /** pictures by name; the clips among them come back to be decoded here (ui/cosmetic-icons.ts) */
  icons: (names: string[]) => Promise<{ pictures: Record<string, string | null>; decode: string[] }>;
  heroPortraits: (ids: string[]) => Promise<Record<string, string>>;
  heroPortraitsByName: (names: string[]) => Promise<Record<string, string>>;
  pick: (slot: string, itemId: string, itemName: string, effectId: string) => Promise<Reply<{ record: LibRecord }>>;
  pickSet: (setId: string) => Promise<Reply<{ applied: number; pieces: number }>>;
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

/* The content channels (src/ipc-game.ts, ipc-presets.ts, ipc-settings.ts): the catalog, the item
 * schema and the free cosmetics it enables, the pictures, the Source 2 toolchain, what the network
 * told the app, and presets. */
import type { CatalogData } from '../catalog/data.ts';
import type { CosmeticSet, CosmeticSlot, HeroAttribute, LookPick } from '../catalog/types.ts';
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
  /** downloads per catalog mod, keyed "category/group/mod" or "category/group/mod/look"; {} when the counter cannot be reached */
  downloadCounts: () => Promise<Record<string, number>>;
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

/** One line of Settings' "Repair the app" (src/app-repair.ts). */
export interface RepairStep { id: 'game' | 'files' | 'caches'; ok: boolean; text: string; mods?: string[] }

export interface PatchApi {
  state: () => Promise<PatchState>;
  setEnabled: (on: boolean) => Promise<Reply>;
  refreshSchema: () => Promise<Reply>;
  /** Stop the item table's build and put back the change that started it (issue #425). */
  cancelBuild: () => Promise<{ ok: true; undone: number; left: string[] } | { ok: false; reason: 'nothing' | 'unknown' }>;
  /** what was done about the last Dota patch, and the two things the banner can ask for */
  repairState: () => Promise<RepairState>;
  repairNow: () => Promise<RepairState>;
  repairSeen: () => Promise<RepairState>;
  /** the patch, the mod files and the pictures, one line each */
  repairApp: () => Promise<RepairStep[]>;
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

/** A catalog mod the signed config marks as misbehaving, by category and catalog name. */
export interface ModIssue { cat: string; mod: string; text: string }

export interface ConfigApi {
  state: () => Promise<{ features: Record<string, unknown>; notices: Notice[]; issues?: ModIssue[]; seen: string[] }>;
  noticeSeen: (id: string) => Promise<string[]>;
}

export interface CosmeticsApi {
  slots: () => Promise<{ slots: CosmeticSlot[]; sets: CosmeticSet[]; heroAttrs?: Record<string, HeroAttribute>; names?: Record<string, string> } & Record<string, unknown>>;
  /** pictures by name; the clips among them come back to be decoded here (ui/cosmetic-icons.ts) */
  icons: (names: string[]) => Promise<{ pictures: Record<string, string | null>; decode: string[] }>;
  heroPortraits: (ids: string[]) => Promise<Record<string, string>>;
  heroPortraitsByName: (names: string[]) => Promise<Record<string, string>>;
  pick: (slot: string, itemId: string, itemName: string, effectId: string) => Promise<Reply<{ record: LibRecord }>>;
  /** style: the look each piece that has it goes on in, 0 for the first */
  pickSet: (setId: string, style?: number) => Promise<Reply<{ applied: number; pieces: number }>>;
  wearLook: (hero: string, picks: LookPick[]) => Promise<Reply<{ applied: number; picks: number }>>;
}

/** The whole arcana, or only its colour over one the player has (src/arcana-service.ts). */
export type ArcanaMode = 'mod' | 'recolor';

/** One arcana the window builds: whether the game has its files, its picture, the one built before. */
export interface ArcanaWindow {
  set: string;
  name: string;
  available: boolean;
  picture: string | null;
  installed: { id: string; color: [number, number, number]; mode: ArcanaMode; enabled: boolean } | null;
  /** only the colour is built, for an item the hero wears (an immortal with no gem of its own) */
  colorOnly: boolean;
}

/** A prismatic gem's colour, as items_game has it (src/gem-colors.ts). */
export interface GemColor { key: string; name: string; rgb: [number, number, number] }

/** The arcanas built out of the game's own files, in a colour of the user's (src/arcana-service.ts). */
export interface ArcanaApi {
  /** every arcana the window builds, and the game's prismatic gems to offer as colours */
  state: () => Promise<Reply<{ arcanas: ArcanaWindow[]; gems: GemColor[] }>>;
  /** build one and put it in My mods, in place of the one built before */
  install: (set: string, color: [number, number, number], mode: ArcanaMode) => Promise<Reply<{ record: LibRecord }>>;
}

/** A look a side of the map can take: a tower item or a tree set (src/map-looks-service.ts). */
export interface MapOption { id: string; name: string; sides: ('radiant' | 'dire')[] }

/** Towers or trees. */
export type MapKind = 'towers' | 'trees';

/** Towers and trees from the game's own looks, per side (src/map-looks-service.ts). */
export interface MapLooksApi {
  /** the looks of each kind, and the record built before for each */
  state: () => Promise<Reply<{
    towers: MapOption[];
    trees: MapOption[];
    installed: Record<MapKind, { id: string; radiant: string | null; dire: string | null; enabled: boolean } | null>;
  }>>;
  /** build a kind with a look per side (null: as in the game) and put it in My mods */
  install: (kind: MapKind, radiant: string | null, dire: string | null) => Promise<Reply<{ record: LibRecord }>>;
}

/** The in-game HUD smaller or larger (src/hud-scale-service.ts). */
export interface HudApi {
  /** the scale on now, the HUD mod it would go on (null: the game's own), and whether ValveResourceFormat is downloaded */
  state: () => Promise<Reply<{ installed: { id: string; scale: number; base: string; enabled: boolean } | null; hudMod: string | null; vrf: boolean }>>;
  /** the HUD at this percent, put in My mods */
  install: (scale: number) => Promise<Reply<{ record: LibRecord }>>;
}

/** A rank medal: tier 0 (not calibrated) to 8 (Immortal), stars 1 to 5, an Immortal's leaderboard place. */
export interface RankMedal { tier: number; stars: number; top: 0 | 5000 | 100 | 10 }
/** The medal (null: the player's own), a level per hero, and one for every hero not named. */
export interface RankLook { medal: RankMedal | null; levels: Record<string, number>; every: number | null }

/** The rank medal and hero levels of the player's own screen (src/rank-look-service.ts). */
/** A kind of decor taken off the map (src/map-decor.ts). */
export type DecorGroup = 'plants' | 'debris';

/** The map without its decor (src/ipc-decor.ts). */
export interface DecorApi {
  /** the groups off the map now, and how many materials each takes on this map */
  state: () => Promise<Reply<{ installed: { id: string; groups: DecorGroup[]; enabled: boolean } | null; counts: Record<DecorGroup, number> | null }>>;
  install: (groups: DecorGroup[]) => Promise<Reply<{ record: LibRecord }>>;
}

export interface RankApi {
  /** the look on now, the heroes of this patch, and whether ValveResourceFormat is downloaded */
  state: () => Promise<Reply<{ installed: { id: string; look: RankLook; enabled: boolean } | null; heroes: { id: string; name: string }[]; vrf: boolean }>>;
  /** the medals by picture name (rank0..rank8, rank8a..c) and the six badge tiers, as data URIs */
  pictures: () => Promise<Reply<{ medals: Record<string, string>; badges: string[] }>>;
  /** the look built and put in My mods */
  install: (look: RankLook) => Promise<Reply<{ record: LibRecord }>>;
}

/** The main menu's background of the user's own (src/menu-background-service.ts). */
export interface BackgroundApi {
  /** the background on now, if any */
  state: () => Promise<Reply<{ installed: { id: string; source: string; dim: number; blur: number; enabled: boolean } | null }>>;
  /** a WebM behind the menu (null: the one on now, with a new dimming and blur), put in My mods */
  install: (webm: Uint8Array | null, source: string | null, dim: number, blur: number) => Promise<Reply<{ record: LibRecord }>>;
}

/** One part of a hero that takes a colour of its own (src/recolor-layers.ts). */
export interface PaintLayer { id: string; kind: 'ability' | 'abilityIcon' | 'effects' | 'portrait' | 'body' | 'item'; name: string | null; files: number }

/** A hero recoloured part by part (src/hero-paint-service.ts). */
export interface PaintApi {
  /** the hero's layers, and the colour of each on now */
  state: (hero: string) => Promise<Reply<{ layers: PaintLayer[]; installed: { id: string; layers: Record<string, string>; enabled: boolean } | null; vrf: boolean }>>;
  /** the hero in a #rrggbb per layer that is on, put in My mods in place of the one before */
  install: (hero: string, colors: Record<string, string>, label: string) => Promise<Reply<{ record: LibRecord }>>;
}

/** How a sound of the user's goes on an event: instead of Valve's, or with it. */
export type SoundMode = 'replace' | 'layer';
/** A sound of the user's on one event, as the hero's record keeps it. */
export interface SoundEdit { event: string; mode: SoundMode; volume: number; sound: string; name: string }
/** An event of a hero's that plays a sound. */
export interface HeroEvent { name: string; type: string; files: number }

export interface SoundsApi {
  /** every hero with an events file: game id and name */
  heroes: () => Promise<Reply<{ heroes: { id: string; name: string }[] }>>;
  /** a hero's events, and the sounds of the user's on them */
  hero: (hero: string) => Promise<Reply<{ hero: string; events: HeroEvent[]; edits: SoundEdit[]; recId: string | null }>>;
  /** a 16-bit PCM WAV on an event, the hero compiled again and put in My mods */
  add: (hero: string, event: string, mode: SoundMode, volume: number, wav: Uint8Array, label: string) => Promise<Reply<{ record: LibRecord | null }>>;
  /** the sound of the user's off an event; the last one off removes the record */
  remove: (hero: string, event: string) => Promise<Reply<{ record: LibRecord | null }>>;
}

/** The item builder's 3D preview (src/hero-preview.ts): the body with its idle and each slot's model, as GLB bytes. */
export interface Preview3dApi {
  models: (hero: string, slots: { slot: string; stock: string }[]) => Promise<
    | { ok: true; body: Uint8Array; parts: { slot: string; name: string; glb: Uint8Array }[]; missing: string[] }
    | { ok: false; reason: 'no-game' | 'no-tool' | 'no-body'; error?: string }>;
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
  /** which one you are in: what is on is exactly this one, or it was applied last and changed since */
  on?: 'active' | 'changed' | null;
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

/** A ready-made preset as src/ipc-presets.ts answers it. */
export interface ReadyPresetRecord {
  id: string;
  name: string;
  about: string;
  mods: { categoryId: string; name: string; styleLabel: string | null }[];
  taken: string | null;
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
  /** the ready-made presets (config/presets.json), in the window's language; taken: the preset it became */
  ready: () => Promise<ReadyPresetRecord[]>;
  /** a ready preset added, installed and applied */
  takeReady: (id: string) => Promise<Reply<{ installed: number; errors: string[] }>>;
  onLink: (cb: (res: unknown) => void) => void;
}

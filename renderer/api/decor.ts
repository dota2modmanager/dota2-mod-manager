/* The Optimization window's channels (src/ipc-decor.ts, crates/mm-core/src/looks/map_decor.rs, owner_preview3d.rs). */
import type { LibRecord } from '../library/types.ts';
import type { Reply } from './reply.ts';

/** A group the Optimization window takes out of the game (crates/mm-core/src/looks/map_optimize.rs). */
export type DecorGroup = 'critters' | 'grass' | 'stains' | 'rocks' | 'waterfalls' | 'river' | 'mapFx' | 'rays' | 'fires'
  | 'towerFx' | 'courierFx' | 'eventFx' | 'weather' | 'treesSimple' | 'trees' | 'dusk' | 'dark';

/** A layer of a terrain blend: its picture as PNG bytes, its tint (linear) and its UV scale. */
export interface GroundLayer { png: Uint8Array; tint: [number, number, number]; scale: number }

/** What the window's 3D scene stands for a group, as source paths: the map's models it takes away (for the trees the heavy ones, and `after`, the one they become) and a few of its effects. */
export interface DecorSample { models: string[]; particles: string[]; after?: string; materials?: string[]; swaps?: [string, string][] }

/** A catalog terrain that is a pak, as the 3D map takes it: by each material's path, what it hides,
 * each other one's picture (PNG) and tint (linear), and the ground's layers. */
export interface TerrainPaint {
  kind: 'pak';
  hidden: string[];
  plain: Record<string, { png: Uint8Array | null; tint: [number, number, number] }>;
  grounds: Record<string, GroundLayer[]>;
}

/** A lighting zone of the default map as the window's light reads it (crates/mm-core/src/looks/map_build.rs weather_lights):
 * colours 0-255 sRGB, the rest the game's numbers. */
export interface ZoneLight {
  color_day?: number[]; light_scale_day?: number; ambient_color_day?: number[]; ambient_scale_day?: number;
  fog_color_day?: number[]; fog_start_day?: number; fog_end_day?: number; fog_height_day?: number; fog_hight_color_day?: number[];
  lightning_intensity_max?: number; lightning_period_min?: number; lightning_period_max?: number;
}

/** The map without its decor, and the rest of Optimization (src/ipc-decor.ts). */
export interface DecorApi {
  /** the groups taken out now, how many files each takes on this map, and what the scene stands for each */
  state: () => Promise<Reply<{ installed: { id: string; groups: string[]; enabled: boolean } | null;
    /** the map of one's own (crates/mm-core/src/looks/map_make.rs): what it is made of (base:game:winter, weather:snow, dark, facets:small) */
    map?: { id: string; names: string[]; enabled: boolean } | null;
    /** the everyday zone's light ("plain") and each weather's, by its key ("rain") */
    weatherLight?: Record<string, ZoneLight> | null;
    counts: Partial<Record<DecorGroup, number>> | null; samples?: Partial<Record<DecorGroup, DecorSample>> | null;
    /** the game's other maps with a ground of their own, and how many of this map's grounds each has one for */
    grounds?: { id: string; count: number }[];
    /** the game's terrain items, each with the map it puts in place of the default one ("winter") */
    terrains?: { id: string; name: string; map: string }[];
    /** the game's weather items, and the default one that puts the game's own back */
    weathers?: { id: string; name: string; key: string }[]; defaultWeather?: { id: string; name: string } | null }>>;
  /** Optimization's groups; with kind "map" the map of one's own instead: its names, the ground's tint ("rrggbb") and facets */
  install: (groups: string[], tint?: string, facets?: string, kind?: '' | 'map') => Promise<Reply<{ record: LibRecord }>>;
  /** the game's whole map made ready for the window (minutes the first time), then served on mm-map; tool: whether the Source 2 toolchain is there */
  scene: (map?: string) => Promise<{ ready: boolean; tool: boolean; size?: number }>;
  /** the map decor:scene made ready, as GLB bytes; null when there is none */
  map: (map?: string) => Promise<Uint8Array | null>;
  /** a catalog Trees mod's tree models (downloaded as an install would), or why not */
  modTrees: (file: string) => Promise<{ models?: string[]; error?: string } | null>;
  /** a catalog terrain for the 3D map: a whole map, or a pak whose materials go on the default map */
  paint: (file: string) => Promise<TerrainPaint | { kind: 'map' } | { error: string } | null>;
  /** one of them as a GLB */
  modModel: (file: string, model: string) => Promise<Uint8Array | null>;
  /** another map's ground for the 3D view: for each of this map's grounds (its material, no _c) that map's layers */
  ground: (map: string, facets?: string) => Promise<{ materials: Record<string, GroundLayer[]> } | null>;
}

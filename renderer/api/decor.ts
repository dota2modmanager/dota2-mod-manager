/* The Optimization window's channels (crates/mm-core/src/looks/map_decor.rs, owner_studios.rs, owner_preview3d.rs). */
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
  /** each *_day number has its *_night twin, the light the zone turns to by night (map-light.ts) */
  color_night?: number[]; light_scale_night?: number; ambient_color_night?: number[]; ambient_scale_night?: number;
  light_direction_night?: number[]; ambient_direction_night?: number[];
  shadow_color_night?: number[]; shadow_secondary_color_night?: number[]; shadow_scale_night?: number; shadow_ground_scale_night?: number;
  fog_color_night?: number[]; fog_start_night?: number; fog_end_night?: number; fog_height_night?: number; fog_hight_color_night?: number[];
  specular_color_night?: number[]; specular_independence_night?: number; specular_direction_night?: number[]; specular_power_night?: number;
  color_day?: number[]; light_scale_day?: number; ambient_color_day?: number[]; ambient_scale_day?: number;
  /** pitch, yaw, roll in degrees: where the sun shines to, and the light around comes from */
  light_direction_day?: number[]; ambient_direction_day?: number[];
  /** the light in the shadows: on what faces up, on what faces down, and their strengths */
  shadow_color_day?: number[]; shadow_secondary_color_day?: number[]; shadow_scale_day?: number; shadow_ground_scale_day?: number;
  fog_color_day?: number[]; fog_start_day?: number; fog_end_day?: number; fog_height_day?: number; fog_hight_color_day?: number[];
  lightning_intensity_max?: number; lightning_period_min?: number; lightning_period_max?: number;
  /** how much of the light around the shadows and the clouds take (0: none) */
  ambient_shadow_amount?: number;
  /** the shine's colour, and how little of it the sun's colour takes (0: all) */
  specular_color_day?: number[]; specular_independence_day?: number;
  /** where the shine comes from (pitch, yaw, roll in degrees) and how tight it is (-1: the map's global_specular_power) */
  specular_direction_day?: number[]; specular_power_day?: number;
  /** what the whole map shares (map_build.rs global_light): the clouds (their picture's path, size in
   * inches, each layer's pitch-yaw-roll and inches a second), the specular power, the fog's shape */
  cloud_texture?: string; cloud_scale?: number; cloud1_direction?: number[]; cloud1_speed?: number; cloud2_direction?: number[]; cloud2_speed?: number;
  global_specular_power?: number; fog_exponent?: number; fog_max_density?: number;
  /** the everyday zone only: the map's small lights (lamps, braziers), each [x, y, z, r, g, b, intensity, radius],
   * place and reach in inches, colour 0-255 sRGB (map_build.rs local_lights) */
  local_lights?: number[][];
  /** the everyday zone only: the map's standing effects (map_build.rs world_effects), place in inches, turn in degrees */
  world_effects?: { fx: string; at: number[]; turn: number[]; group?: string }[];
  /** the map's zones for this look, each where it stands (x, y in inches), lit in full within its inner
   * radius and not at all past its outer one (map_build.rs zone_places): the view takes the blend at its middle */
  zones?: ZonePlace[];
}

/** Dota's video settings, convar to value (crates/mm-core/src/game/video_settings.rs). */
export type VideoSettings = Record<string, boolean | number | string>;

/** One lighting zone of the map: RF, RB, DF or DT (map_build.rs zone_places). */
export interface ZonePlace { zone: string; at: number[]; inner: number; outer: number; light: ZoneLight }

/** The map without its decor, and the rest of Optimization. */
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
    weathers?: { id: string; name: string; key: string }[]; defaultWeather?: { id: string; name: string } | null;
    /** the player's Dota video settings by convar (video.txt: r_deferred_specular, cl_globallight_shadow_mode,
     * r_dota_allow_wind_on_trees, r_grass_quality, dota_cheap_water...), null with no Steam account or file */
    video?: VideoSettings | null }>>;
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

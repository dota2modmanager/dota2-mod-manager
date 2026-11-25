/* The item builder's 3D preview (crates/mm-core/src/models/hero_preview.rs, issue #417): the models as GLB bytes, the
 * game's staging of the hero, and its particles and attachment points as the main process reads them. */

/** How the game stages the hero on its loadout (crates/mm-core/src/models/hero_showcase.rs): GLB space, linear colours. */
/** A hero's portrait entry as the game writes it (Source angles in degrees, colours 0-255), for the viewer's light. */
export interface StageLighting {
  light: { angles: [number, number, number]; color: [number, number, number]; scale: number };
  ambient: { angles: [number, number, number]; color: [number, number, number]; scale: number };
  shadow: { color: [number, number, number]; scale: number };
  camera: { position: [number, number, number] | null; angles: [number, number, number] | null; fov: number | null };
}

/** Colours 0-255; `wash` is a colour laid over the picture at its alpha (0-1). */
export interface StageBackdrop {
  top: [number, number, number] | null;
  bottom: [number, number, number] | null;
  image: string | null;
  wash: [number, number, number, number] | null;
  opacity: number;
}

export interface HeroStage {
  /** the painted panels behind the hero on the game's hero page (crates/mm-core/src/models/hero_backdrop.rs) */
  backdrop?: StageBackdrop | null;
  /** the loadout page's light for this hero; absent, the viewer keeps its default */
  lighting?: StageLighting | null;
  scale: number;
  camera: [number, number, number];
  key: { from: [number, number, number]; color: [number, number, number] } | null;
  ambient: { from: [number, number, number]; color: [number, number, number] } | null;
  background: [number, number, number] | null;
  pedestal: string | null;
}

export interface SnapshotPoint {
  position: [number, number, number];
  weights: [string, number][];
  color?: [number, number, number];
  normal?: [number, number, number];
  alpha?: number;
  radius?: number;
  attributes?: Record<number, number | [number, number, number]>;
}

export type ParticleJson = null | boolean | number | string | ParticleJson[] | { [k: string]: ParticleJson };
/** A game particle system as JSON, its children inlined (crates/mm-core/src/models/particle_spec.rs). */
export interface ParticleDef { path: string; tree: { [k: string]: ParticleJson }; children: ParticleDef[]; childGroup?: number; delay?: number; endcap?: boolean; snapshot?: SnapshotPoint[]; snapshots?: Record<number, SnapshotPoint[]> }
/** An attachment point of a model: its bone, and its offset and turn from it in Source units. */
export interface LoadoutAttachment { bones: string[]; offsets: number[][]; rotations: number[][]; weights: number[]; ignoreRotation: boolean }
export interface LoadoutResources {
  snapshots: Record<string, Record<string, unknown>>;
  materials: Record<string, { shader: string; floats: Record<string, number>; ints: Record<string, number>; vectors: Record<string, number[]>; textures: Record<string, string> }>;
  models: Record<string, { data: string }>;
  sheets: Record<string, { id: number; clamp: boolean; frames: { time: number; uv: number[]; crop: number[] }[] }[]>;
  missing: string[];
}
export interface Attachment extends Partial<LoadoutAttachment> { name: string; bone: string; offset: [number, number, number]; rotation: [number, number, number, number] }

/** A hero's other form or summon on the stage (crates/mm-core/src/models/hero_companions.rs). */
export interface Companion { model: string; clip: string | null; glb: Uint8Array }

/** What a body can be shown doing (crates/mm-core/src/models/model_loadout.rs motionList). */
export interface Motion { name: string; group: 'stance' | 'idle' | 'run' | 'attack' | 'ability' | 'emote' | 'other'; act: string; mods: string[]; once: boolean }

/** The item builder's 3D preview (crates/mm-core/src/models/hero_preview.rs): the body with its loadout clip, each slot's model and the pedestal, as GLB bytes. */
export interface PreviewSlot { slot: string; stock: string; tryOn?: { itemId: string; effectId: string; targetItemId?: string } }

export interface Preview3dApi {
  /** Prepare the disk cache for one hero without returning its large 3D data to the window. */
  warm: (hero: string, slots: PreviewSlot[]) => Promise<{ ok: boolean; missing?: number; error?: string }>;
  /** a slot's options exported ahead, so trying one on finds its model cached; how many models it asked for */
  prefetch: (hero: string, slots: PreviewSlot[], slot: string, items: string[]) => Promise<number>;
  /** an effect's particle system, for its picture; null where the game has none */
  effect: (id: string) => Promise<{ def: ParticleDef; sprites: Record<string, Uint8Array>; resources?: LoadoutResources } | null>;
  /** a map prop's model alone (a tree set's) as GLB bytes, for its picture; null without the game or the toolchain */
  model: (file: string) => Promise<Uint8Array | null>;
  /** a pedestal's picture kept in the app's folder, as a data URI, or null (item_builder/hero_pedestals.rs) */
  pedestalPicture: (model: string) => Promise<string | null>;
  /** keep a pedestal's picture the window drew, a WebP, for the next time */
  keepPedestalPicture: (model: string, webp: Uint8Array) => Promise<{ ok: true } | { error: string }>;
  /** the picture behind a hero on the game's hero page: a small copy kept before, or the game's JPEG */
  backdrop: (image: string) => Promise<{ kept: string } | { jpeg: Uint8Array } | null>;
  keepBackdrop: (image: string, webp: Uint8Array) => Promise<{ ok: true } | { error: string }>;
  /** every clip of a body, without its pictures, as GLB bytes; null without the game or the toolchain */
  motions: (body: string) => Promise<Uint8Array | null>;
  /** the hero a catalog mod is for (its archive downloaded and unpacked the first time), by its files or else by `hint`, its name */
  modHero: (category: string, file: string, hint: string) => Promise<{ hero?: string | null; error?: string }>;
  /** the hero in these slots' stock items with the catalog mod's files over the game's, as models answers */
  modModels: (category: string, file: string, hero: string, slots: PreviewSlot[]) => Promise<ModelsAnswer>;
  /** a catalog mod of the world (wards, creeps, towers...) as models answers: the model at `index` of its models (or the game's it recolours) as the body with its effects, the others beside it; `models` names them all */
  modProps: (category: string, file: string, index: number) => Promise<ModelsAnswer & { models?: string[]; index?: number }>;
  models: (hero: string, slots: PreviewSlot[]) => Promise<ModelsAnswer>;
}

/** What the stage is drawn from: the hero's models, or why there are none. */
export type ModelsAnswer =
    | {
      ok: true; body: Uint8Array; clip: string | null; model: string; motions: Motion[]; stage: HeroStage; pedestal: Uint8Array | null;
      parts: { slot: string; name: string; glb: Uint8Array; attachments: Attachment[]; hidden: string[] }[]; missing: string[]; hidden: string[];
      attachments: Attachment[]; particles: { part: number; def: ParticleDef }[]; sprites: Record<string, Uint8Array>; resources?: LoadoutResources;
      /** his other forms and summons, stood beside him: the bear, the dragon, the spirits */
      companions?: Companion[];
    }
    | { ok: false; reason: 'no-game' | 'no-tool' | 'no-body' | 'no-mod'; error?: string };

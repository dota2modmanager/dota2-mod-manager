/* The item builder's 3D preview (src/hero-preview.ts, issue #417): the models as GLB bytes, the
 * game's staging of the hero, and its particles and attachment points as the main process reads them. */

/** How the game stages the hero on its loadout (src/hero-showcase.ts): GLB space, linear colours. */
export interface HeroStage {
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
/** A game particle system as JSON, its children inlined (src/particle-spec.ts). */
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

/** What a body can be shown doing (src/model-loadout.ts motionList). */
export interface Motion { name: string; group: 'stance' | 'idle' | 'run' | 'attack' | 'ability' | 'emote' | 'other'; act: string; mods: string[]; once: boolean }

/** The item builder's 3D preview (src/hero-preview.ts): the body with its loadout clip, each slot's model and the pedestal, as GLB bytes. */
export interface PreviewSlot { slot: string; stock: string; tryOn?: { itemId: string; effectId: string } }

export interface Preview3dApi {
  /** Prepare the disk cache for one hero without returning its large 3D data to the window. */
  warm: (hero: string, slots: PreviewSlot[]) => Promise<{ ok: boolean; missing?: number; error?: string }>;
  /** a slot's options exported ahead, so trying one on finds its model cached; how many models it asked for */
  prefetch: (hero: string, slots: PreviewSlot[], slot: string, items: string[]) => Promise<number>;
  /** an effect's particle system, for its picture; null where the game has none */
  effect: (id: string) => Promise<{ def: ParticleDef; sprites: Record<string, Uint8Array>; resources?: LoadoutResources } | null>;
  /** a map prop's model alone (a tree set's) as GLB bytes, for its picture; null without the game or the toolchain */
  model: (file: string) => Promise<Uint8Array | null>;
  /** every clip of a body, without its pictures, as GLB bytes; null without the game or the toolchain */
  motions: (body: string) => Promise<Uint8Array | null>;
  models: (hero: string, slots: PreviewSlot[]) => Promise<
    | {
      ok: true; body: Uint8Array; clip: string | null; model: string; motions: Motion[]; stage: HeroStage; pedestal: Uint8Array | null;
      parts: { slot: string; name: string; glb: Uint8Array; attachments: Attachment[]; hidden: string[] }[]; missing: string[]; hidden: string[];
      attachments: Attachment[]; particles: { part: number; def: ParticleDef }[]; sprites: Record<string, Uint8Array>; resources?: LoadoutResources;
    }
    | { ok: false; reason: 'no-game' | 'no-tool' | 'no-body'; error?: string }>;
}

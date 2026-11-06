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

export type ParticleJson = null | boolean | number | string | ParticleJson[] | { [k: string]: ParticleJson };
/** A game particle system as JSON, its children inlined (src/particle-spec.ts). */
export interface ParticleDef { path: string; tree: { [k: string]: ParticleJson }; children: ParticleDef[] }
/** An attachment point of a model: its bone, and its offset and turn from it in Source units. */
export interface Attachment { name: string; bone: string; offset: [number, number, number]; rotation: [number, number, number, number] }

/** What a body can be shown doing (src/model-loadout.ts motionList). */
export interface Motion { name: string; group: 'stance' | 'idle' | 'run' | 'attack' | 'ability' | 'emote' | 'other' }

/** The item builder's 3D preview (src/hero-preview.ts): the body with its loadout clip, each slot's model and the pedestal, as GLB bytes. */
export interface Preview3dApi {
  /** an effect's particle system, for its picture; null where the game has none */
  effect: (id: string) => Promise<{ def: ParticleDef; sprites: Record<string, Uint8Array> } | null>;
  /** a map prop's model alone (a tree set's) as GLB bytes, for its picture; null without the game or the toolchain */
  model: (file: string) => Promise<Uint8Array | null>;
  /** every clip of a body, without its pictures, as GLB bytes; null without the game or the toolchain */
  motions: (body: string) => Promise<Uint8Array | null>;
  models: (hero: string, slots: { slot: string; stock: string }[]) => Promise<
    | {
      ok: true; body: Uint8Array; clip: string | null; model: string; motions: Motion[]; stage: HeroStage; pedestal: Uint8Array | null;
      parts: { slot: string; name: string; glb: Uint8Array; attachments: Attachment[] }[]; missing: string[];
      attachments: Attachment[]; particles: { part: number; def: ParticleDef }[]; sprites: Record<string, Uint8Array>;
    }
    | { ok: false; reason: 'no-game' | 'no-tool' | 'no-body'; error?: string }>;
}

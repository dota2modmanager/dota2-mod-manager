/* The effect editor's channels (src/ipc-effects.ts). */
import type { LibRecord } from '../library/types.ts';
import type { ParticleDef } from './preview3d.ts';
import type { Reply } from './reply.ts';

/** One effect's changes (src/effect-edit.ts): percent of what the file says, and a colour. */
export interface EffectEdit { size?: number; count?: number; life?: number; speed?: number; tint?: string }
/** A whole effect's changes, by system path; '*' goes on every system of it. */
export type EffectEdits = Record<string, EffectEdit>;

/** One line of a hero's effects (src/effect-finder.ts). */
export interface EffectGroup { id: string; kind: 'ability' | 'effects' | 'items'; ability: string | null; name: string | null; paths: string[] }
/** An ability a search found. */
export interface AbilityHit { hero: string; ability: string; name: string }

/** The effect editor (src/effect-edit-service.ts). */
export interface FxApi {
  /** the effects with these words in their path, the abilities with them in their name, and the effects changed so far */
  search: (query: string) => Promise<Reply<{ paths: string[]; abilities: AbilityHit[]; saved: { path: string; name: string }[] }>>;
  /** every hero */
  heroes: () => Promise<Reply<{ heroes: { hero: string; name: string }[] }>>;
  /** a hero's effects, ability by ability */
  hero: (hero: string) => Promise<Reply<{ groups: EffectGroup[] }>>;
  /** one effect: its systems, the changes on it now, and how it plays with them */
  load: (path: string) => Promise<Reply<{ path: string; edits: EffectEdits; def: ParticleDef; sprites: Record<string, Uint8Array>; systems: { path: string; depth: number }[] }>>;
  /** how an effect plays with these changes */
  preview: (path: string, edits: EffectEdits) => Promise<Reply<{ def: ParticleDef | null }>>;
  /** the effect with these changes, put in My mods */
  install: (path: string, edits: EffectEdits) => Promise<Reply<{ record: LibRecord }>>;
}

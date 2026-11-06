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
  /** one effect, or `ability:hero/ability` for all of an ability's: its systems, the changes on it now, how it plays with them, and how many item versions it has */
  load: (path: string) => Promise<Reply<{ path: string; name: string; edits: EffectEdits; defs: ParticleDef[]; sprites: Record<string, Uint8Array>; systems: { path: string; depth: number }[]; variants: number; items: boolean }>>;
  /** how it plays with these changes */
  preview: (path: string, edits: EffectEdits) => Promise<Reply<{ defs: ParticleDef[] }>>;
  /** it with these changes, put in My mods; `items` takes the versions items play along */
  install: (path: string, edits: EffectEdits, items?: boolean) => Promise<Reply<{ record: LibRecord }>>;
}

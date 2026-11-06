/* The effect editor's channels (src/ipc-effects.ts). */
import type { LibRecord } from '../library/types.ts';
import type { ParticleDef } from './preview3d.ts';
import type { Reply } from './reply.ts';

/** One effect's changes (src/effect-edit.ts): percent of what the file says, and a colour. */
export interface EffectEdit { size?: number; count?: number; life?: number; speed?: number; tint?: string }
/** A whole effect's changes, by system path; '*' goes on every system of it. */
export type EffectEdits = Record<string, EffectEdit>;

/** The effect editor (src/effect-edit-service.ts). */
export interface FxApi {
  /** the effects with these words in their path, and those changed so far */
  search: (query: string) => Promise<Reply<{ paths: string[]; saved: { path: string; name: string }[] }>>;
  /** one effect: its systems, the changes on it now, and how it plays with them */
  load: (path: string) => Promise<Reply<{ path: string; edits: EffectEdits; def: ParticleDef; sprites: Record<string, Uint8Array>; systems: { path: string; depth: number }[] }>>;
  /** how an effect plays with these changes */
  preview: (path: string, edits: EffectEdits) => Promise<Reply<{ def: ParticleDef | null }>>;
  /** the effect with these changes, put in My mods */
  install: (path: string, edits: EffectEdits) => Promise<Reply<{ record: LibRecord }>>;
}

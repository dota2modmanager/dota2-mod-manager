/* window.api.portraits: a hero's portrait and movie in the hero picker of the user's own
 * (crates/mm-core/src/looks/hero_portrait_service.rs). */
import type { Reply } from './reply.ts';
import type { LibRecord } from '../library/types.ts';

/** A picture of the hero the picker draws, and the size the user's picture is cut to for it. */
export interface PortraitTarget { path: string; width: number; height: number }

export interface PortraitsApi {
  /** every hero the picker has, and what of his own each has on */
  state: () => Promise<Reply<{ heroes: { hero: string; name: string }[]; own: Record<string, { still: boolean; movie: boolean; enabled: boolean }> }>>;
  /** one hero: his pictures' sizes, the game's movie and the user's picture and movie, as data URIs */
  hero: (hero: string) => Promise<Reply<{ hero: string; name: string; targets: PortraitTarget[]; gameMovie: string | null; ownStill: string | null; ownMovie: string | null; source: string | null }>>;
  /** pictures (a PNG per target, cut to its size) and a movie on the hero; drop takes parts off. The last part off removes the record */
  set: (hero: string, stills: { path: string; png: Uint8Array }[], movie: Uint8Array | null, drop: ('still' | 'movie')[], source: string | null) => Promise<Reply<{ record: LibRecord | null }>>;
}

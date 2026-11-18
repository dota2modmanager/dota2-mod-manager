/* window.api.music: background music of the user's own (crates/mm-core/src/looks/own_music_service.rs). */
import type { Reply } from './reply.ts';
import type { LibRecord } from '../library/types.ts';

/** A song on now or picked for the build: the id the core keeps it under, its name and length. */
export interface MusicSongEntry { id: string; name: string; seconds?: number | null; role?: 'calm' | 'fight' | 'roshan' }

export interface MusicApi {
  /** the songs on now and where they play */
  state: () => Promise<Reply<{ songs: MusicSongEntry[]; menu: boolean; game: boolean; installed: boolean; enabled: boolean }>>;
  /** a song (MP3, or 16-bit PCM WAV) kept for the build; its id */
  keep: (song: Uint8Array) => Promise<Reply<{ id: string }>>;
  /** the songs built into the game's music: role fight in fights, roshan in Roshan's fight, the rest where the two switches say; nothing to play takes the record off */
  install: (songs: MusicSongEntry[], menu: boolean, game: boolean) => Promise<Reply<{ record: LibRecord | null }>>;
}

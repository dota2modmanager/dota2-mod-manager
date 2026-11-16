/* window.api.cursor: a cursor set of the user's own (crates/mm-core/src/looks/cursor_maker.rs). */
import type { Reply } from './reply.ts';
import type { LibRecord } from '../library/types.ts';

/** A cursor of the game: the sizes it is written at, its largest picture and its hotspot as a share of it. */
export interface GameCursor { name: string; sizes: number[]; picture: string; width: number; hot: [number, number] }

/** One of the game's own cursor sets (resource/cursor/valve/*, workshop/*): its cursors' pictures and hotspots. */
export interface CursorPack { id: string; cursors: Record<string, { picture: string; hot: [number, number] }> }

/** A cursor the window drew: its hotspot as a share of it, and a PNG per size (32, 48, 72, 96). */
export interface DrawnCursor { name: string; hot: [number, number]; pngs: Record<string, Uint8Array> }

export interface CursorApi {
  /** the game's cursors, the game's own cursor sets, and the set made before (its design and its pictures by sha1, as data URIs) */
  state: () => Promise<Reply<{ cursors: GameCursor[]; packs: CursorPack[]; installed: { id: string; design: unknown; pictures: Record<string, string>; enabled: boolean } | null }>>;
  /** the set written and put in My mods in place of the one before; the other cursor sets go off */
  install: (design: object, drawn: DrawnCursor[], pictures: { id: string; png: Uint8Array }[]) => Promise<Reply<{ record: LibRecord }>>;
}

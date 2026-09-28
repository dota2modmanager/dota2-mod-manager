/* The shapes most channels answer with (src/ipc-*.js).
 *
 * A handler that can fail answers { error } and otherwise { ok: true, ...what it did }. Every caller
 * asks about `error` first and reads the rest only when there is none, so the fields are written
 * as present: a type that made each one optional would be asked about again at every use, and the
 * one question that matters is already asked. */

export type Reply<T extends object = object> = T & { ok?: boolean; error?: string };

/** A channel that opens a system dialog: closing it is an answer too. */
export type Dialog<T extends object = object> = Reply<T> & { cancelled?: boolean };

/** Files taken in by an import (src/import.js): what came in, and what did not. */
export interface ImportReply {
  cancelled?: boolean;
  error?: string;
  errors?: { source: string; error: string }[];
  /** one per mod; a multi-volume pack glued into one file says how many parts it was */
  imported?: { merged?: number; [key: string]: unknown }[];
}

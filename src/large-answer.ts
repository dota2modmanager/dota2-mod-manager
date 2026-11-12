/* An answer too big for one IPC message.
 *
 * Electron hands an answer to the window as one message, and a message of 787 MB (Primal Beast in
 * Age of Attrition, 2026-11-08) ends the main process with no error to catch: the whole app closes.
 * So the big pieces of an answer stay here. The answer names them, and preload.js fetches each in
 * slices no message can choke on, then puts the answer back together. */

/** What stands in an answer for a piece that stays behind. */
export type LargeRef = { $large: number; size: number; text: boolean };

const SMALLEST = 1024 * 1024;
const SLICE = 32 * 1024 * 1024;
// a window that was reloaded halfway never asks for the rest
const KEEP_MS = 5 * 60 * 1000;

/** The store behind one channel's answers. */
export function createLargeAnswers({ now = Date.now, smallest = SMALLEST, slice = SLICE } = {}) {
  const held = new Map<number, { bytes: Uint8Array; at: number }>();
  let next = 1;

  const hold = (bytes: Uint8Array, text: boolean): LargeRef => {
    const id = next++;
    held.set(id, { bytes, at: now() });
    return { $large: id, size: bytes.byteLength, text };
  };

  const pack = (value: unknown): unknown => {
    if (ArrayBuffer.isView(value)) {
      const bytes = value as Uint8Array;
      return bytes.byteLength >= smallest ? hold(bytes, false) : value;
    }
    if (typeof value === 'string') return value.length >= smallest ? hold(Buffer.from(value, 'utf8'), true) : value;
    if (Array.isArray(value)) return value.map(pack);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pack(v)]));
    return value;
  };

  return {
    /** The answer with its big pieces left here; send this one. */
    pack<T>(answer: T): T {
      for (const [id, entry] of held) if (now() - entry.at > KEEP_MS) held.delete(id);
      return pack(answer) as T;
    },
    /** A slice of a piece, from `offset`. The last slice lets the piece go. Null for one not held. */
    slice(id: number, offset: number): Uint8Array | null {
      const entry = held.get(id);
      if (!entry) return null;
      const end = offset + slice;
      if (end >= entry.bytes.byteLength) held.delete(id);
      return entry.bytes.subarray(offset, end);
    },
    /** How many pieces wait to be fetched. */
    get waiting() { return held.size; },
  };
}

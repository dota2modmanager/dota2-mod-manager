/* One file for buildVpk(), from a path and its bytes, the way a test writes it. */
import { entryAt, type VpkEntry } from '../../src/vpk.ts';

/** One inline-data entry in the shape buildVpk() wants. */
export function entry(relPath: string, body: string | Buffer): VpkEntry {
  return entryAt(relPath, Buffer.isBuffer(body) ? body : Buffer.from(body));
}

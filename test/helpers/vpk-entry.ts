/* One file for buildVpk(), from a path and its bytes, the way a test writes it. */
import { crc32 } from 'node:zlib';
import type { VpkEntry } from '../../src/vpk.ts';

/** One inline-data entry in the shape buildVpk() wants. */
export function entry(relPath: string, body: string | Buffer): VpkEntry {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const norm = relPath.replace(/\\/g, '/').toLowerCase();
  const slash = norm.lastIndexOf('/');
  const file = slash === -1 ? norm : norm.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return {
    ext: dot === -1 ? ' ' : file.slice(dot + 1),
    folder: slash === -1 ? ' ' : norm.slice(0, slash),
    name: dot === -1 ? file : file.slice(0, dot),
    data,
    preload: Buffer.alloc(0),
    crc: crc32(data) >>> 0,
  };
}

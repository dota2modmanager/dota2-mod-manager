/* What a mod is, whatever it is packed as: a fingerprint of its files (src/vpk.ts gathers the VPK
 * code; the index is read in src/vpk-read.ts). The catalog's fingerprint list and the import both
 * recognise a mod by it. */
import crypto from 'node:crypto';
import { listVpkEntries } from './vpk-read.ts';

/** Content fingerprint of a mod: sha1 over its sorted (path:crc) index. Independent of
 * packaging (multi-part vs single, filename), so the same mod installed from the site,
 * from another tool, or via this app all hash identically — the basis for recognising
 * a foreign vpk as a specific catalog mod. */
export function fingerprintEntries(entries: { path: string; crc: number }[]): string {
  const canon = entries.map((e) => `${e.path}:${e.crc}`).sort().join('\n');
  return crypto.createHash('sha1').update(canon).digest('hex');
}

/** fingerprintEntries over one VPK's index. */
export function fingerprintVpk(buf: Buffer): string {
  return fingerprintEntries(listVpkEntries(buf));
}

/** Content fingerprint of a loose-file mod (cursors, fonts): sha1 over sorted
 * "path:sha1(bytes)". Paths should already be normalized (top folder stripped,
 * lowercased) so it reproduces from either the source zip or the installed files. */
export function fingerprintFiles(files: { path: string; data: Buffer }[]): string {
  const rows = files.map((f) => `${f.path}:${crypto.createHash('sha1').update(f.data).digest('hex')}`);
  return crypto.createHash('sha1').update(rows.sort().join('\n')).digest('hex');
}

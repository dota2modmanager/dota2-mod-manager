// The signature list, dota.signatures (src/patcher.ts explains the patch): the hashes the client
// checks gameinfo_branchspecific.gi against, Valve's own entry for it, and the one line this app
// appends after the DIGEST and takes off again.
import crypto from 'node:crypto';

const SIG_PREFIX = '...\\..\\..\\dota\\gameinfo_branchspecific.gi';

/** A file's hashes as the signature list writes them, uppercase hex. */
export interface Hashes { sha1: string; crc: string }

/** built on the first call */
let crcTable: Uint32Array | null = null;

/** CRC-32 as the signature list records it. */
export function crc32(buf: Buffer): number {
  let table = crcTable;
  if (!table) {
    table = crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The signature list stores the CRC little-endian, uppercase, like the SHA1 next to it. */
export function fileHashes(buf: Buffer): { sha1: string; crc: string } {
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex').toUpperCase();
  const le = Buffer.alloc(4);
  le.writeUInt32LE(crc32(buf));
  return { sha1, crc: le.toString('hex').toUpperCase() };
}

/** The line the signature list needs for the patched file. */
export function signatureLine(buf: Buffer): string {
  const { sha1, crc } = fileHashes(buf);
  return `${SIG_PREFIX}~SHA1:${sha1};CRC:${crc}`;
}

/**
 * Valve's own recorded hash for the file we edit, read out of the signature list the game
 * ships with. Ground truth: whatever we put back has to hash to this, or the client refuses
 * the install ("verify integrity of game files") and matchmaking stops. Their entry sits
 * BEFORE the DIGEST line - ours, when present, is appended after it.
 */
export function vanillaBranchHashes(signaturesText: string): Hashes | null {
  const lines = signaturesText.split(/\r?\n/);
  const digest = lines.findIndex((l) => l.startsWith('DIGEST:'));
  const scope = digest === -1 ? lines : lines.slice(0, digest);
  for (const l of scope) {
    const m = /gameinfo_branchspecific\.gi~SHA1:([0-9A-Fa-f]{40});CRC:([0-9A-Fa-f]{8})\s*$/.exec(l);
    if (m) return { sha1: m[1].toUpperCase(), crc: m[2].toUpperCase() };
  }
  return null;
}

/** Whether a file hashes to what Valve recorded; with no record there is nothing to contradict. */
export function matchesVanilla(text: string, want: Hashes | null): boolean {
  if (!want) return true; // no list to check against - nothing to contradict
  const h = fileHashes(Buffer.from(text, 'latin1'));
  return h.sha1 === want.sha1 && h.crc === want.crc;
}

/**
 * Is our line present in a signature list? Valve's own pristine file ALREADY carries an
 * entry for gameinfo_branchspecific.gi (before DIGEST, with the vanilla hash), so merely
 * finding the path proves nothing - only an entry appended AFTER the DIGEST line is ours.
 * Getting this wrong makes a pristine list look patched, which freezes the backup at a
 * pre-update build and lets apply() write those stale hashes over the live file.
 */
export function hasSignaturePatch(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const digest = lines.findIndex((l) => l.startsWith('DIGEST:'));
  if (digest === -1) return false;
  return lines.slice(digest + 1).some((l) => l.startsWith(SIG_PREFIX + '~'));
}

/** Same for the signature list: our line is appended after the DIGEST line, so anything of
 * ours past that point comes off and the file the game shipped is left behind. */
export function stripSignatures(text: string): string {
  const lines = text.split(/\r?\n/);
  const digest = lines.findIndex((l) => l.startsWith('DIGEST:'));
  if (digest === -1) return text;
  const kept = lines.filter((l, i) => i <= digest || !l.startsWith(SIG_PREFIX + '~'));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.join('\r\n') + '\r\n';
}

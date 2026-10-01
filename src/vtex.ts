/* The picture inside a compiled Source 2 texture, when it is already a picture.
 *
 * Panorama's own images are authored as PNG and Valve compiles most of them with the format
 * left as PNG: the .vtex_c is a small resource header with the untouched PNG file appended
 * after it. Nothing has to be decoded, and the header says exactly where the picture starts -
 * its very first field is the size of the resource part.
 *
 * Measured over the installed game (2026-08-28): of 3000 item icons under
 * panorama/images/econ/items, 2877 are a ready-made PNG and 123 are block-compressed. So the
 * cosmetics picker can show almost every item straight from the game, offline and correct for
 * that build, with no 48 MB toolchain involved; the remainder still falls back to it.
 *
 * A block-compressed texture returns null here rather than a guess. Decoding BC formats is a
 * different job and the fallback already exists.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from('IEND', 'ascii');

/**
 * @param buf contents of a .vtex_c
 * @returns the PNG file it carries, or null when it carries pixels instead
 */
export function pngFromVtex(buf: unknown): Buffer | null {
  // fileSize is the first field of every Source 2 resource, and the picture is what follows
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  const headerBytes = buf.readUInt32LE(0);
  if (!headerBytes || headerBytes + PNG_SIGNATURE.length >= buf.length) return null;
  if (buf.compare(PNG_SIGNATURE, 0, PNG_SIGNATURE.length, headerBytes, headerBytes + PNG_SIGNATURE.length) !== 0) {
    return null;
  }
  const png = buf.subarray(headerBytes);
  // A tail that does not end on IEND is not a whole file, whatever its first bytes say.
  const end = png.lastIndexOf(IEND);
  if (end < 0 || end + 8 !== png.length) return null;
  return png;
}

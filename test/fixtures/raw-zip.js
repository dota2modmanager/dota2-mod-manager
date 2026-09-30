/* A zip written byte by byte, for archives no well-behaved library will write: names with
 * "../" left in them, and headers that lie about sizes. Shared by test/safe-zip.test.ts,
 * test/safe-zip-fuzz.test.js and tools/fuzz-parsers.mjs, so all three build the same bytes.
 */
const zlib = require('zlib');

/**
 * A zip laid out byte by byte, because the interesting archives cannot be written by a
 * well-behaved library: adm-zip cleans "../" out of a name as it stores it, and no writer
 * will put a size in the header that the data does not have. Stored (uncompressed) entries,
 * which is all these tests need.
 * @param {Array<{name: string, data: Buffer, declaredSize?: number}>} entries
 */
function rawZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf-8');
    const data = e.data;
    const crc = zlib.crc32(data);
    const claimed = e.declaredSize == null ? data.length : e.declaredSize;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(claimed, 22);     // uncompressed size, truthful or not
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);             // version made by
    cen.writeUInt16LE(20, 6);             // version needed
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(claimed, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);        // where the local header sits
    central.push(cen, name);
    offset += local.length + name.length + data.length;
  }

  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

module.exports = { rawZip };

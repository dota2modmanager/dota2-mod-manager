/* A compiled texture holding a DXT1 or DXT5 picture, for src/vtex.ts rgbaFromVtex and its Rust
 * twin: the resource header with one DATA block, the texture's own header in it, and the blocks
 * after. The pixels are a fixed spread of bytes, so both sides decode the same thing. */
export function dxtTexture(format: number, width: number, height: number, ycocg = false, mips = 1): Buffer {
  const note = ycocg ? Buffer.from('Texture Compiler Version Image YCoCg Conversion', 'latin1') : Buffer.alloc(0);
  const head = Buffer.alloc(80);
  const size = 80 + note.length;
  head.writeUInt32LE(size, 0);
  head.writeUInt16LE(12, 4);
  head.writeUInt32LE(8, 8); // the block table, 8 bytes on from this field
  head.writeUInt32LE(1, 12);
  head.write('DATA', 16, 'latin1');
  head.writeUInt32LE(20, 20); // the DATA block at 40, 20 bytes on from this field
  head.writeUInt32LE(40, 24);
  head.writeUInt16LE(width, 60);
  head.writeUInt16LE(height, 62);
  head.writeUInt16LE(1, 64);
  head[66] = format;
  head[67] = mips;
  const blocks = Math.ceil(width / 4) * Math.ceil(height / 4) * (format === 1 ? 8 : 16);
  const pixels = Buffer.from(Array.from({ length: blocks }, (_, i) => (i * 97 + (i >> 3) * 41 + 13) % 256));
  return Buffer.concat([head, note, pixels]);
}

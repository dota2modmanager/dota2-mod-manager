/* A cube map's six faces as one strip, for the 3D preview's hero shader, which reads a cube from a
 * row of six square faces (vendor/dota-loadout/src/viewer.js cubeOf). ValveResourceFormat writes a
 * cube texture as six PNGs, name_rt, _lf, _bk, _ft, _up and _dn: the cube's faces in their order,
 * +X, -X, +Y, -Y, +Z, -Z in the game's axes, which is the order the shader looks them up in once it
 * has turned a direction into the game's axes (TO_SOURCE). Without them the preview had no
 * reflection at all, and a metal the game shows by its cube map (Razor's Severing Crest, at five
 * times its weight; Terrorblade's blades) came out black.
 *
 * The main process has no image codec of its own (Electron's is not there in the tests), so this is
 * one for what the toolchain writes: 8-bit, not interlaced, grey, grey with alpha, RGB or RGBA. */
import zlib from 'node:zlib';

/** The faces' suffixes, in the order the strip lays them out. */
export const CUBE_FACES = ['rt', 'lf', 'bk', 'ft', 'up', 'dn'] as const;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** A PNG's pixels as RGBA, or null for one this does not read. */
export function decodePng(png: Buffer): { width: number; height: number; rgba: Buffer } | null {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) return null;
  let at = 8, width = 0, height = 0, type = -1, depth = 0, interlace = 0;
  const data: Buffer[] = [];
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at), kind = png.toString('latin1', at + 4, at + 8), body = png.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'IDAT') data.push(body);
    else if (kind === 'IEND') break;
    at += 12 + length;
  }
  const channels = CHANNELS[type];
  if (!channels || depth !== 8 || interlace || !width || !height) return null;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0, up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const [r, g, b] = channels >= 3 ? [pixels[s], pixels[s + 1], pixels[s + 2]] : [pixels[s], pixels[s], pixels[s]];
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = channels === 4 ? pixels[s + 3] : channels === 2 ? pixels[s + 1] : 255;
  }
  return { width, height, rgba };
}

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  return (bytes: Buffer) => { let c = -1; for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();

function chunk(kind: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8), tail = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0); head.write(kind, 4, 'latin1');
  tail.writeUInt32BE(CRC(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/** RGBA pixels as a PNG. */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Six square faces of one size, in CUBE_FACES order, as one strip; null where they are not that. */
export function cubeStrip(faces: Buffer[]): Buffer | null {
  if (faces.length !== 6) return null;
  const decoded = faces.map(decodePng);
  const size = decoded[0]?.width;
  if (!size || decoded.some((f) => !f || f.width !== size || f.height !== size)) return null;
  const strip = Buffer.alloc(size * 6 * size * 4);
  decoded.forEach((face, i) => {
    for (let y = 0; y < size; y++) face!.rgba.copy(strip, (y * size * 6 + i * size) * 4, y * size * 4, (y + 1) * size * 4);
  });
  return encodePng(size * 6, size, strip);
}

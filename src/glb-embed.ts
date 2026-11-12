/* A GLB with its pictures inside (issue #417).
 *
 * The toolchain exports a model as a GLB whose textures are PNG files beside it, named by relative
 * links. The window reads a model from the bytes the main process hands it, with no folder to
 * follow a link into, so each linked picture goes into the GLB's binary chunk and the image points
 * at its slice of it: one file the three.js loader takes as it is. */
import fs from 'node:fs';
import path from 'node:path';

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

type Gltf = {
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
};

const pad4 = (n: number) => (n + 3) & ~3;

/** The GLB's JSON and binary chunks. */
export function readGlb(buf: Buffer): { json: Gltf; bin: Buffer } {
  if (buf.length < 20 || buf.readUInt32LE(0) !== MAGIC || buf.readUInt32LE(4) !== 2) throw new Error('not a GLB 2.0 file');
  let at = 12;
  let json: Gltf | null = null;
  let bin = Buffer.alloc(0);
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString('utf8')) as Gltf;
    else if (type === BIN_CHUNK) bin = Buffer.from(body);
    at += 8 + len;
  }
  if (!json) throw new Error('a GLB without its JSON');
  return { json, bin };
}

/** A GLB out of its two chunks, each padded as the format wants. */
export function writeGlb(json: Gltf, bin: Buffer): Buffer {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc(pad4(text.length) - text.length, 0x20)]);
  const data = Buffer.concat([bin, Buffer.alloc(pad4(bin.length) - bin.length)]);
  const head = Buffer.alloc(12);
  const chunk = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  const parts = [head, chunk(text.length, JSON_CHUNK), text, ...(data.length ? [chunk(data.length, BIN_CHUNK), data] : [])];
  const out = Buffer.concat(parts);
  out.writeUInt32LE(MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  return out;
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** A grey PNG of one pixel: what a picture that cannot be had becomes, since an image with no data fails its whole material. */
export const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/**
 * The GLB at `file` with every picture it links to put inside it. A link that leaves the GLB's
 * folder, or names a file that is not there, gets the blank pixel: the model shows without that texture.
 */
export function embedGlb(file: string): Buffer {
  const { json, bin } = readGlb(fs.readFileSync(file));
  const dir = path.dirname(file);
  const parts: Buffer[] = [bin];
  let size = pad4(bin.length);
  if (bin.length !== size) parts.push(Buffer.alloc(size - bin.length));
  json.bufferViews ??= [];
  for (const img of json.images || []) {
    if (!img.uri || img.uri.startsWith('data:')) continue;
    const at = path.resolve(dir, decodeURIComponent(img.uri));
    const mime = MIME[path.extname(at).toLowerCase()];
    const rel = path.relative(dir, at);
    delete img.uri;
    const ok = !!mime && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(at);
    const data = ok ? fs.readFileSync(at) : BLANK_PNG;
    img.bufferView = json.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: data.length }) - 1;
    img.mimeType = ok ? mime : 'image/png';
    parts.push(data, Buffer.alloc(pad4(data.length) - data.length));
    size += pad4(data.length);
  }
  const all = Buffer.concat(parts);
  json.buffers = [{ byteLength: all.length }];
  return writeGlb(json, all);
}

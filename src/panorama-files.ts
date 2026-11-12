/* Panorama's compiled styles (vcss_c) and scripts (vjs_c), read and written here rather than by
 * Valve's resourcecompiler (Discord, 2026-11-09: a rank medal refused with "Schema mismatches
 * reported", the user's Workshop Tools of two Dota updates; most users have no tools at all).
 *
 * A script's DATA block is its JavaScript as it is (PanoramaScript from version 4), so a script is
 * any of the game's scripts with its DATA in place of theirs. A style's DATA is a CRC, the pictures
 * it names, each with its width and height (and a CRC from version 3), and then its CSS, minified,
 * as text. The CRC of a style Valve ships does not match its text either (ValveResourceFormat
 * stopped checking it for that), so nothing checks it. A picture the new CSS names that the style
 * did not is added to the list, with its size, and to the style's references (RERL), as the
 * compiler does, so the game loads it with the style.
 */
import zlib from 'node:zlib';
import { resourceBlock, resourceBlocks, withReferences, references } from './resource.ts';

/** A picture a style names: its path (the compiled texture's, without _c), its size and its CRC. */
export interface StyleImage { path: string; width: number; height: number; crc: number }

const version = (file: Buffer) => file.readUInt16LE(6);

/** A compiled style's pictures and its CSS; throws when it is not one. */
export function readStyle(file: Buffer): { images: StyleImage[]; css: string } {
  const d = resourceBlock(file, 'DATA').data;
  const withCrc = version(file) >= 3;
  const images: StyleImage[] = [];
  let at = 6;
  for (let i = 0; i < d.readUInt16LE(4); i++) {
    const end = d.indexOf(0, at);
    if (end < 0) throw new Error('panorama: a style whose picture list does not end');
    const path = d.toString('utf8', at, end);
    at = end + 1;
    images.push({ path, width: d.readUInt16LE(at), height: d.readUInt16LE(at + 2), crc: withCrc ? d.readUInt32LE(at + 4) : 0 });
    at += withCrc ? 8 : 4;
  }
  if (at > d.length) throw new Error('panorama: a style shorter than its picture list');
  return { images, css: d.subarray(at).toString('utf8') };
}

/** The pictures CSS names, as compiled textures: s2r://a/b.vtex, and a/b.png as the compiler turns it into a/b_png.vtex. */
export function cssImages(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/url\(\s*["']?(s2r:\/\/|file:\/\/\{images\}\/)?([^"')]+?)["']?\s*\)/g)) {
    // file://{images}/ is panorama/images/
    const p = `${m[1]?.startsWith('file') ? 'panorama/images/' : ''}${m[2].replace(/^\/+/, '')}`.toLowerCase();
    if (p.endsWith('.vtex')) out.add(p);
    else if (/\.(png|psd|jpg|tga)$/.test(p)) out.add(p.replace(/\.(\w+)$/, '_$1.vtex'));
  }
  return [...out];
}

/** A texture's width and height, from its DATA block (VTEX: two shorts after the flags and reflectivity). */
export function textureSize(vtexC: Buffer): { width: number; height: number } {
  const d = resourceBlock(vtexC, 'DATA').data;
  return { width: d.readUInt16LE(20), height: d.readUInt16LE(22) };
}

/**
 * `file`, a compiled style, with `css` in place of its own. Each picture the CSS names that the
 * style does not list is looked up: `known` from another style that lists it, else its size from
 * `texture` (the compiled texture, from the game's pak). One neither has stays out of the list and
 * is still named in the CSS, where the game loads it when a panel needs it.
 */
export function writeStyle(file: Buffer, css: string, known: (path: string) => StyleImage | null, texture: (path: string) => Buffer | null): Buffer {
  const { images } = readStyle(file);
  const listed = new Set(images.map((i) => i.path.toLowerCase()));
  const added: StyleImage[] = [];
  for (const path of cssImages(css)) {
    if (listed.has(path)) continue;
    let image = known(path);
    if (!image) {
      const tex = texture(`${path}_c`);
      if (tex) { try { image = { path, ...textureSize(tex), crc: 0 }; } catch { image = null; } }
    }
    if (image) { added.push({ ...image, path }); listed.add(path); }
  }
  const all = [...images, ...added];
  const withCrc = version(file) >= 3;
  const body = Buffer.from(css, 'utf8');
  const head = Buffer.alloc(6);
  head.writeUInt32LE(zlib.crc32(body), 0);
  head.writeUInt16LE(all.length, 4);
  const list = all.map((i) => {
    const b = Buffer.alloc(withCrc ? 8 : 4);
    b.writeUInt16LE(i.width, 0);
    b.writeUInt16LE(i.height, 2);
    if (withCrc) b.writeUInt32LE(i.crc >>> 0, 4);
    return Buffer.concat([Buffer.from(`${i.path}\0`, 'utf8'), b]);
  });
  let out = resourceBlock(file, 'DATA').replace(Buffer.concat([head, ...list, body]));
  if (added.length && resourceBlocks(out).some((b) => b.name === 'RERL')) {
    const have = new Set(references(out).map((r) => r.toLowerCase()));
    const missing = added.map((i) => i.path).filter((p) => !have.has(p));
    if (missing.length) out = withReferences(out, missing);
  }
  return out;
}

/** A compiled script with `js` as its text: `template`, any of the game's scripts, with its DATA replaced. */
export function writeScript(template: Buffer, js: string): Buffer {
  if (version(template) < 4) throw new Error('panorama: a script template older than plain text');
  return resourceBlock(template, 'DATA').replace(Buffer.from(js, 'utf8'));
}

/** The pictures of several styles by path, for writeStyle's `known`. */
export function imagesOf(styles: Buffer[]): (path: string) => StyleImage | null {
  const map = new Map<string, StyleImage>();
  for (const s of styles) { try { for (const i of readStyle(s).images) map.set(i.path.toLowerCase(), i); } catch { /* not a style: none from it */ } }
  return (p) => map.get(p.toLowerCase()) ?? null;
}

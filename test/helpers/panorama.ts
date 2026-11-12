/* Compiled Panorama files in the shape the game has them (src/panorama-files.ts): a style, version 3,
 * with its pictures listed before its CSS, and a script, version 4, whose DATA is its text. */
import zlib from 'node:zlib';
import { resource, rerl } from './kv3-build.ts';

const versioned = (file: Buffer, v: number) => { file.writeUInt16LE(v, 6); return file; };

/** A compiled style: `css` after a list of `images` (path, width, height). */
export function style(css: string, images: [string, number, number][] = []): Buffer {
  const body = Buffer.from(css);
  const head = Buffer.alloc(6);
  head.writeUInt32LE(zlib.crc32(body), 0);
  head.writeUInt16LE(images.length, 4);
  const list = images.map(([p, w, h]) => { const b = Buffer.alloc(8); b.writeUInt16LE(w, 0); b.writeUInt16LE(h, 2); return Buffer.concat([Buffer.from(`${p}\0`), b]); });
  return versioned(resource([['RERL', rerl(images.map(([p]) => p))], ['RED2', Buffer.from('editor')], ['DATA', Buffer.concat([head, ...list, body])]]), 3);
}

/** A compiled script with `js` as its text. */
export const script = (js = 'function f() {}') => versioned(resource([['RED2', Buffer.from('editor')], ['DATA', Buffer.from(js)]]), 4);

/** A compiled texture `w` by `h`: the two shorts at 20 and 22 of its DATA. */
export function texture(w: number, h: number): Buffer {
  const d = Buffer.alloc(40);
  d.writeUInt16LE(w, 20);
  d.writeUInt16LE(h, 22);
  return resource([['RED2', Buffer.from('editor')], ['DATA', d]]);
}

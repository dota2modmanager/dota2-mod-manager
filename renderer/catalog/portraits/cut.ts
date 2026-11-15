/* The user's picture as the hero picker draws it: cut to the exact size of each of the hero's
 * portraits, filling it from the middle, as PNG. The game's file keeps its header and takes this
 * PNG after it (crates/mm-core/src/looks/hero_portrait_service.rs), so the size has to be the one
 * the header says. The picker's movie is the menu background's encoder at the movie's size. */
import { coverRect, encodeBackground } from '../background/encode.ts';
import type { PortraitTarget } from '../../api/portraits.ts';

/** The game's picker movies are 256x256; the user's is cut to that, and kept short like theirs. */
export const MOVIE = { width: 256, height: 256, seconds: 12 };

/** One PNG of `file`'s first frame at width x height. */
export async function cutPng(file: Blob, width: number, height: number): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  try {
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, ...coverRect(bmp.width, bmp.height, width, height), 0, 0, width, height);
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    bmp.close();
  }
}

/** A PNG for every target of the hero, in its order. */
export async function cutAll(file: Blob, targets: PortraitTarget[]): Promise<{ path: string; png: Uint8Array }[]> {
  const out = [];
  for (const t of targets) out.push({ path: t.path, png: await cutPng(file, t.width, t.height) });
  return out;
}

/** The picker movie out of a picture, GIF or video. */
export async function cutMovie(file: File, progress: (p: number) => void): Promise<Uint8Array> {
  return (await encodeBackground(file, progress, MOVIE)).webm;
}

/** A data URI (what the core answers) as an address a <video> streams from. */
export async function blobUrl(uri: string): Promise<string> {
  return URL.createObjectURL(await (await fetch(uri)).blob());
}

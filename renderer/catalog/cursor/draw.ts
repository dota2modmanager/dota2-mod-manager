/* A cursor drawn on a canvas at one size, as the window shows it and as it is sent to be written
 * into the game's files: a picture (a set's cursor or the user's own) fitted into the square. */
import { place } from './design.ts';

export function drawPicture(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const b = place(img.naturalWidth, img.naturalHeight, size);
  ctx.drawImage(img, b.x, b.y, b.w, b.h);
  return c;
}

export async function pngOf(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  if (!blob) throw new Error(L`Не удалось нарисовать курсор`);
  return new Uint8Array(await blob.arrayBuffer());
}

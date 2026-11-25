/* The painted backdrop behind a hero, as the game's hero page lays it under its 3D panel
 * (crates/mm-core/src/models/hero_backdrop.rs, hero_loadout_background_images.css): the hero's
 * gradient; over it the hero's painting, blurred, desaturated to 0.4, tinted by its wash colour and
 * shown at 0.3 through a mask bright at the top; the whole saturated to 1.3; dark edges.
 *
 * The game composes those in linear light, which CSS layers cannot (they mix in sRGB and came out
 * darker and greyer than the game), so they are composed here once on a 16:9 canvas and the stage
 * shows the result. The painting is a 4K JPEG in the game: the first time it is shrunk to 960
 * pixels and kept by the app, so later opens read the small copy. */
import type { StageBackdrop } from '../../api/preview3d.ts';

const W = 960, H = 540;

/** The painting as something to draw: the kept copy, else the game's, shrunk and kept. */
async function painting(image: string): Promise<ImageBitmap | null> {
  const got = await window.api.preview3d.backdrop(image).catch(() => null);
  if (!got) return null;
  if ('kept' in got) return createImageBitmap(await (await fetch(got.kept)).blob());
  const big = await createImageBitmap(new Blob([got.jpeg as BlobPart], { type: 'image/jpeg' }));
  const c = new OffscreenCanvas(W, Math.round((big.height * W) / big.width));
  c.getContext('2d')?.drawImage(big, 0, 0, c.width, c.height);
  big.close();
  const webp = await c.convertToBlob({ type: 'image/webp', quality: 0.85 });
  void window.api.preview3d.keepBackdrop(image, new Uint8Array(await webp.arrayBuffer())).catch(() => null);
  return createImageBitmap(webp);
}

const toLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c: number) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The backdrop composed as the game composes it, a 16:9 picture as a blob URL. */
export async function composeBackdrop(b: StageBackdrop, paint: ImageBitmap | null): Promise<string> {
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let pic: Uint8ClampedArray | null = null;
  if (paint) {
    // the page's painting: blur 6px at 1080 lines, saturation 0.4, contain in a 16:9 screen
    ctx.filter = `blur(${6 * (H / 1080)}px) saturate(0.4)`;
    ctx.drawImage(paint, 0, 0, W, H);
    ctx.filter = 'none';
    pic = ctx.getImageData(0, 0, W, H).data;
  }
  const top = (b.top ?? [0, 0, 0]).map(toLinear), bottom = (b.bottom ?? b.top ?? [0, 0, 0]).map(toLinear);
  const wash = b.wash ? b.wash.slice(0, 3).map(toLinear) : null, washA = b.wash?.[3] ?? 0;
  const out = ctx.createImageData(W, H), o = out.data;
  const lum = (r: number, g: number, bl: number) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  for (let y = 0; y < H; y++) {
    const fy = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const fx = x / (W - 1), i = (y * W + x) * 4;
      let c = [0, 1, 2].map((k) => top[k] + (bottom[k] - top[k]) * fy);
      if (pic) {
        let p = [0, 1, 2].map((k) => toLinear(pic![i + k]));
        // the wash tints: it multiplies, by its colour at its alpha (fits the game far better than laying it over)
        if (wash) p = p.map((v, k) => v * (1 + (wash[k] - 1) * washA));
        // loadout_background_image_mask: bright at the top middle, gone toward the sides and the bottom
        const m = clamp01(1 - Math.hypot((fx - 0.5) / 0.75, fy / 0.8));
        const a = b.opacity * m;
        c = c.map((v, k) => v + (p[k] - v) * a);
      }
      // the container's saturation 1.3
      const l = lum(c[0], c[1], c[2]);
      c = c.map((v) => Math.max(0, l + (v - l) * 1.3));
      // DarkEdges: clear to a fifth of the way out, black at the ellipse 80% x 100%
      const e = clamp01((Math.hypot((fx - 0.5) / 0.8, (fy - 0.5) / 1.0) - 0.2) / 0.8);
      c = c.map((v) => v * (1 - e));
      o[i] = toSrgb(c[0]); o[i + 1] = toSrgb(c[1]); o[i + 2] = toSrgb(c[2]); o[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

/** Lay the backdrop under the stage's canvas, in place of one laid before. */
export async function showBackdrop(host: HTMLElement, b: StageBackdrop, signal?: AbortSignal): Promise<void> {
  const paint = b.image ? await painting(b.image) : null;
  if (signal?.aborted) return;
  const url = await composeBackdrop(b, paint);
  paint?.close();
  if (signal?.aborted || !host.isConnected) { URL.revokeObjectURL(url); return; }
  host.querySelector(':scope > .preview3d-backdrop')?.remove();
  const layer = document.createElement('div');
  layer.className = 'preview3d-backdrop';
  layer.style.setProperty('--bd-image', `url("${url}")`);

  host.prepend(layer);
  host.classList.add('has-backdrop');
}

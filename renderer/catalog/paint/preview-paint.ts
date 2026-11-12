/* What the recolour window's 3D hero is painted in, worked out from the layers that are on: the
 * body's colour, each worn item's own, and the colour of the effects the stage plays. The scene
 * (preview3d/scene.ts) asks `materialPaint` for each of its materials.
 *
 * It follows what the build will change (src/recolor-layers.ts): the body layer is the textures of
 * the hero's own model folder, which the stock items share, so a stock item without a colour of its
 * own takes the body's; an item's own colour wins over the body's. */
import type { PaintLayer } from '../../api/content.ts';
import { fromHex, type Rgb } from '../arcana/tint.ts';
import { hsv01, modeNumber, type PaintMode } from './paint-mode.ts';

/** A colour for the shader: [h, s, v] (0 to 1) and the mode's number. */
export type PaintTone = [number, number, number, number];

export interface PreviewPaint {
  body: PaintTone | null;
  /** by preview slot: the colour of the item worn there; absent where it has no layer of its own on */
  parts: Record<string, PaintTone>;
  /** by particle (no _c), the colour its effect layer gives it */
  effects: Record<string, Rgb>;
}

export const NO_PAINT: PreviewPaint = { body: null, parts: {}, effects: {} };

const tone = (hex: string, mode: PaintMode): PaintTone | null => {
  const rgb = fromHex(hex);
  return rgb ? [...hsv01(rgb), modeNumber(mode)] as PaintTone : null;
};

/**
 * @param color  a layer's colour as the window would send it
 * @param items  by preview slot, the item worn there
 */
export function previewPaint(layers: readonly PaintLayer[], on: ReadonlySet<string>, color: (id: string) => { hex: string; mode: PaintMode }, items: Record<string, string>): PreviewPaint {
  const out: PreviewPaint = { body: null, parts: {}, effects: {} };
  const lit = (id: string) => on.has(id) && layers.some((l) => l.id === id);
  if (lit('body')) { const c = color('body'); out.body = tone(c.hex, c.mode); }
  for (const [slot, item] of Object.entries(items)) {
    const id = `itemModel:${item}`;
    if (!lit(id)) continue;
    const c = color(id);
    const t = tone(c.hex, c.mode);
    if (t) out.parts[slot] = t;
  }
  for (const l of layers) {
    if (!on.has(l.id) || !l.particles?.length) continue;
    const rgb = fromHex(color(l.id).hex);
    if (rgb) for (const p of l.particles) out.effects[p.toLowerCase().replace(/_c$/, '')] = rgb;
  }
  return out;
}

/**
 * One material's colour in the scene, or null for its own.
 * @param owner  'hero' for the body, 'part-<n>' for the n-th worn item
 * @param path   the material's file, materials/models/…/x.vmat
 * @param slot   the n-th item's preview slot
 */
export function materialPaint(owner: string, path: string, slot: string | undefined, paint: PreviewPaint): PaintTone | null {
  if (owner === 'hero') return paint.body;
  if (!owner.startsWith('part-')) return null;
  const own = slot ? paint.parts[slot] : undefined;
  if (own) return own;
  return path.toLowerCase().replace(/\\/g, '/').startsWith('materials/models/heroes/') ? paint.body : null;
}

/**
 * Every material of the scene with a colour, by its id: the scene's materials as [id, owner and
 * file], and the slot each worn part (part-<n>) stands in.
 */
export function scenePaints(materials: Iterable<[string, { owner: string; materialPath: string }]>, partSlots: readonly string[], paint: PreviewPaint): Record<string, PaintTone> {
  const out: Record<string, PaintTone> = {};
  for (const [id, m] of materials) {
    const part = /^part-(\d+)$/.exec(m.owner);
    const tone = materialPaint(m.owner, m.materialPath, part ? partSlots[Number(part[1])] : undefined, paint);
    if (tone) out[id] = tone;
  }
  return out;
}

/** The scene's particle systems (id to path) that take a colour, as the gem palette has them. */
export function effectPalette(sourcePaths: Record<string, string>, paint: PreviewPaint): Record<string, { rgb: number[]; own: boolean; bake: boolean }> {
  const out: Record<string, { rgb: number[]; own: boolean; bake: boolean }> = {};
  for (const [id, path] of Object.entries(sourcePaths)) {
    const rgb = paint.effects[path.toLowerCase().replace(/_c$/, '')];
    if (rgb) out[id] = { rgb: rgb.map((n) => n / 255), own: true, bake: false };
  }
  return out;
}

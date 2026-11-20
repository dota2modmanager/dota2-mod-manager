/* What the recolour window's 3D hero is painted in, worked out from the values that are on: each
 * material of the scene gets the recipe of its texture (paint-recipe.ts), a tone and a material per
 * colour zone, and the effects the stage plays their colour. The scene (preview3d/scene.ts) asks
 * `scenePaints` for its materials.
 *
 * It follows what the build will change (crates/mm-core/src/looks/hero_paint_service.rs): the body
 * layer is the textures of the hero's own model folder, which the stock items share, so a stock
 * item with nothing of its own takes the body's; an item's own wins over the body's. A material
 * finds its part by the list the layer gave (PaintLayer.parts: the materials drawn from each). */
import type { PaintLayer } from '../../api/content.ts';
import { fromHex, type Rgb } from '../arcana/tint.ts';
import { emptyRecipe, parseLook, recipeOf, shaderPaint, splitKey, type ShaderPaint } from './paint-recipe.ts';

export interface PreviewPaint {
  /** the values on, by key, as the window would send them */
  values: Record<string, string>;
  /** by model layer, its part for each material (materials/….vmat, lower case) */
  parts: Record<string, Record<string, string>>;
  /** by preview slot, the item worn there */
  items: Record<string, string>;
  /** by particle (no _c), the colour its effect layer gives it */
  effects: Record<string, Rgb>;
}

export const NO_PAINT: PreviewPaint = { values: {}, parts: {}, items: {}, effects: {} };

const vmat = (path: string) => path.toLowerCase().replace(/\\/g, '/').replace(/_c$/, '');

/**
 * @param values  by key, the values that are on, as the window would send them
 * @param items   by preview slot, the item worn there
 */
export function previewPaint(layers: readonly PaintLayer[], values: Readonly<Record<string, string>>, items: Record<string, string>): PreviewPaint {
  const out: PreviewPaint = { values: { ...values }, parts: {}, items: { ...items }, effects: {} };
  for (const l of layers) {
    if (l.parts?.length) out.parts[l.id] = Object.fromEntries(l.parts.flatMap((p) => p.materials.map((m) => [vmat(m), p.id])));
    const v = values[l.id];
    if (!v || !l.particles?.length) continue;
    const hex = parseLook(v)?.hex;
    const rgb = hex ? fromHex(hex) : null;
    if (rgb) for (const p of l.particles) out.effects[p.toLowerCase().replace(/_c$/, '')] = rgb;
  }
  return out;
}

/**
 * One material's paint in the scene, or null for its own.
 * @param owner  'hero' for the body, 'part-<n>' for the n-th worn item
 * @param path   the material's file, materials/models/…/x.vmat
 * @param slot   the n-th item's preview slot
 */
export function materialPaint(owner: string, path: string, slot: string | undefined, paint: PreviewPaint): ShaderPaint | null {
  const file = vmat(path);
  const layers: string[] = [];
  if (owner === 'hero') layers.push('body');
  else if (owner.startsWith('part-')) {
    const item = slot ? paint.items[slot] : undefined;
    if (item) layers.push(`itemModel:${item}`);
    if (file.startsWith('materials/models/heroes/')) layers.push('body');
  }
  const used = new Set(Object.keys(paint.values).map((k) => splitKey(k).layer));
  for (const layer of layers) {
    if (!used.has(layer)) continue;
    const recipe = recipeOf(paint.values, layer, paint.parts[layer]?.[file] ?? '');
    if (!emptyRecipe(recipe)) return shaderPaint(recipe);
  }
  return null;
}

/**
 * Every material of the scene with a paint, by its id: the scene's materials as [id, owner and
 * file], and the slot each worn part (part-<n>) stands in.
 */
export function scenePaints(materials: Iterable<[string, { owner: string; materialPath: string }]>, partSlots: readonly string[], paint: PreviewPaint): Record<string, ShaderPaint> {
  const out: Record<string, ShaderPaint> = {};
  for (const [id, m] of materials) {
    const part = /^part-(\d+)$/.exec(m.owner);
    const p = materialPaint(m.owner, m.materialPath, part ? partSlots[Number(part[1])] : undefined, paint);
    if (p) out[id] = p;
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

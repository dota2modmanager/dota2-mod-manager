/* The models of a hero as the item builder dresses it, for the 3D preview in the hero's window
 * (issue #417): the body, and for each slot the item picked there, or the stock item where none is.
 *
 * The models come out of the game's pak01 as GLB files with the toolchain (src/model-glb.ts), the
 * body with its idle clip, and go to the window with their pictures inside (src/glb-embed.ts). In
 * the game a wearable follows the hero's bones by name; the window does the same (renderer
 * catalog/preview3d/scene.ts). An arcana that swaps the whole hero brings its own body, as the
 * build does (src/item-builder.ts itemEffectPatch, the copy that names a hero). */
import path from 'node:path';
import { embedGlb } from './glb-embed.ts';
import { findItem, itemFields } from './schema.ts';
import { itemEffectPatch } from './item-builder.ts';
import { heroModelPath, normalizeAssetPath } from './item-builder-assets.ts';
import { sharedVpkIndex } from './vpk.ts';
import type { createModelGlb } from './model-glb.ts';
import type { Library } from './library.ts';

/** A slot of the hero as the window names it: its id and the stock item it dresses. */
export type PreviewSlot = { slot: string; stock: string };

/** What the window gets: each model's bytes, or why there are none. */
export type HeroModels =
  | { ok: true; body: Uint8Array; parts: { slot: string; name: string; glb: Uint8Array }[]; missing: string[] }
  | { ok: false; reason: 'no-game' | 'no-tool' | 'no-body' };

/** The bones' clips the body is exported with: the hero standing, as the hero's window shows it. */
const CLIPS = ['idle'];

/**
 * The model an item puts on in the style picked, and the body it swaps the hero for. The build
 * copies the item's model over the stock one (`stock`); its other copies are particles and other
 * units' models, which the hero does not wear.
 */
function itemModel(text: string, itemId: string, key: string | undefined, hero: string, stock: string | null): { model: string | null; body: string | null } {
  let body: string | null = null;
  try {
    const copies = itemEffectPatch(text, itemId, key || '').assetCopies;
    body = copies.find((c) => 'hero' in c && c.hero === hero)?.from ?? null;
    const own = stock ? copies.find((c) => 'to' in c && normalizeAssetPath(c.to) === normalizeAssetPath(stock))?.from : null;
    // an arcana that is the whole hero puts on nothing besides its body
    if (own || body) return { model: own || null, body };
  } catch { /* an item the table has lost: its block's own model, if any */ }
  const item = findItem(text, itemId);
  return { model: item ? itemFields(text, item).get('model_player') || null : null, body };
}

/** The 3D preview's models, made on demand. */
export function createHeroPreview({ glb, library, gamePath, vanilla, log = () => {} }: {
  glb: Pick<ReturnType<typeof createModelGlb>, 'glbs'>;
  library: Pick<Library, 'list'>;
  gamePath: () => string | null;
  vanilla: () => string;
  log?: (msg: string) => void;
}) {
  /** The hero's body and what each slot wears now. */
  function plan(name: string, slots: PreviewSlot[]): { body: string; parts: { slot: string; name: string; model: string }[] } | null {
    // the window names the hero as its slots do (magnataur); the scripts and the table, in full
    const hero = name.startsWith('npc_dota_hero_') ? name : `npc_dota_hero_${name}`;
    const game = gamePath();
    if (!game) return null;
    const text = vanilla();
    let body = normalizeAssetPath(heroModelPath(sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk')), hero));
    const parts: { slot: string; name: string; model: string }[] = [];
    for (const s of slots) {
      const rec = library.list().find((r) => r.categoryId === 'cosmetic' && r.slot === s.slot && r.enabled !== false && r.itemId);
      const stockItem = findItem(text, s.stock);
      const stock = stockItem ? itemFields(text, stockItem) : null;
      const picked = rec ? itemModel(text, String(rec.itemId), rec.effectId as string | undefined, hero, stock?.get('model_player') || null) : null;
      if (picked?.body) body = normalizeAssetPath(picked.body);
      const model = picked?.model || stock?.get('model_player');
      if (model) parts.push({ slot: s.slot, name: rec?.name || stock?.get('name') || '', model: normalizeAssetPath(model) });
    }
    return { body, parts };
  }

  /** The body with its idle and each slot's model, as GLB bytes with their pictures inside. */
  async function models(hero: string, slots: PreviewSlot[], hasTool: boolean): Promise<HeroModels> {
    if (!hasTool) return { ok: false, reason: 'no-tool' };
    let p: ReturnType<typeof plan>;
    try { p = plan(hero, slots); } catch (err) { log(`preview 3d: ${(err as Error)?.message || err}`); return { ok: false, reason: 'no-body' }; }
    if (!p) return { ok: false, reason: 'no-game' };
    const bodyFile = (await glb.glbs([p.body], CLIPS))[p.body];
    if (!bodyFile) return { ok: false, reason: 'no-body' };
    const files = await glb.glbs(p.parts.map((x) => x.model));
    const missing: string[] = [];
    const parts: { slot: string; name: string; glb: Uint8Array }[] = [];
    for (const x of p.parts) {
      const f = files[x.model];
      if (f) parts.push({ slot: x.slot, name: x.name, glb: embedGlb(f) });
      else missing.push(x.name || x.model);
    }
    return { ok: true, body: embedGlb(bodyFile), parts, missing };
  }

  return { plan, models };
}

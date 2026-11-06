/* The models of a hero as the item builder dresses it, for the 3D preview in the hero's window
 * (issue #417): the body, and for each slot the item picked there, or the stock item where none is.
 *
 * The models come out of the game's pak01 as GLB files with the toolchain (src/model-glb.ts), the
 * body with its idle clip, and go to the window with their pictures inside (src/glb-embed.ts). In
 * the game a wearable follows the hero's bones by name; the window does the same (renderer
 * catalog/preview3d/scene.ts). An arcana that swaps the whole hero brings its own body, as the
 * build does (src/item-builder.ts itemEffectPatch, the copy that names a hero). */
import fs from 'node:fs';
import path from 'node:path';
import { embedGlb } from './glb-embed.ts';
import { findItem, itemFields } from './schema.ts';
import { itemEffectPatch, itemVisuals } from './item-builder.ts';
import { firstStyleSkin, heroModelPath, normalizeAssetPath } from './item-builder-assets.ts';
import { styleOf, withStyle } from './item-builder-styles.ts';
import { sharedVpkIndex } from './vpk.ts';
import { personaLayouts } from './item-builder-personas.ts';
import { ITEM_EFFECTS } from './item-builder-effects.ts';
import { unusualItemEffect } from './item-builder-unusual.ts';
import { idleSequence, itemActivities, itemModifiers, loadoutSequence, modelSequences, motionList, type Motion } from './model-loadout.ts';
import { heroStage, type HeroStage } from './hero-showcase.ts';
import { heroLoadoutParticles, itemParticles, modelAttachments, particleDef, particleTextures, type Attachment, type ParticleDef } from './particle-spec.ts';
import type { createModelGlb } from './model-glb.ts';
import type { Library } from './library.ts';

/** A slot of the hero as the window names it: its id and the stock item it dresses. */
export type PreviewSlot = { slot: string; stock: string };

/** What the window gets: each model's bytes, or why there are none. */
export type HeroModels =
  | {
    ok: true; body: Uint8Array; clip: string | null; stage: HeroStage; pedestal: Uint8Array | null;
    /** the body's model path, for `motions`, and what else it can be shown doing */
    model: string; motions: Motion[];
    parts: { slot: string; name: string; glb: Uint8Array; attachments: Attachment[] }[]; missing: string[];
    /** the body's attachment points, and the particles: on the body (part -1) or on a part, by its place in `parts` */
    attachments: Attachment[]; particles: { part: number; def: ParticleDef }[];
    /** the particles' textures as PNG bytes, by the path they name (src/model-glb.ts sprites) */
    sprites: Record<string, Uint8Array>;
  }
  | { ok: false; reason: 'no-game' | 'no-tool' | 'no-body' };

/** The clip a body without a loadout sequence stands in (Lone Druid, Magnus). */
const IDLE = 'idle';

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

/**
 * The material set an item wears its model in, 0 for the first: what its style says, or a
 * "model_skin" modifier for the style picked. Luna's Midnight Locks is one model and three sets, and
 * 861 hero items are of this kind (2026-11-06).
 * @param visuals  the item's visuals with the picked style made its first (withStyle)
 */
export function wornSkin(visuals: string): number {
  const own = Number(firstStyleSkin(visuals));
  if (own) return own;
  for (const m of visuals.matchAll(/"asset_modifier\d*"\s*\{([^{}]*)\}/gi)) {
    if (!/"type"\s+"model_skin"/i.test(m[1])) continue;
    if (Number(/"style"\s+"(\d+)"/i.exec(m[1])?.[1] || 0) === 0) return Number(/"skin"\s+"(\d+)"/i.exec(m[1])?.[1] || 0);
  }
  return 0;
}

/**
 * The body an item's "entity_model" modifier puts the hero in: a persona's, which the item's own
 * copies leave out because a persona goes on through its base (src/item-builder-personas.ts).
 */
export function entityModel(block: string, hero: string): string | null {
  for (const m of block.matchAll(/"asset_modifier\d*"\s*\{([^{}]*)\}/gi)) {
    const field = (k: string) => new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(m[1])?.[1];
    if (field('type')?.toLowerCase() === 'entity_model' && field('asset') === hero && /\.vmdl$/i.test(field('modifier') || '')) return field('modifier')!;
  }
  return null;
}

/** The 3D preview's models, made on demand. */
export function createHeroPreview({ glb, library, gamePath, vanilla, log = () => {} }: {
  glb: Pick<ReturnType<typeof createModelGlb>, 'glbs'> & Partial<Pick<ReturnType<typeof createModelGlb>, 'sprites' | 'skinned'>>;
  library: Pick<Library, 'list'>;
  gamePath: () => string | null;
  vanilla: () => string;
  log?: (msg: string) => void;
}) {
  /** The hero's body and what each slot wears now. */
  function plan(name: string, slots: PreviewSlot[]): {
    body: string; clip: string | null; idle: string; motions: Motion[]; stage: HeroStage; heroFx: string[]; read: (p: string) => Buffer | null;
    parts: { slot: string; name: string; model: string; skin: number; fx: string[] }[];
  } | null {
    // the window names the hero as its slots do (magnataur); the scripts and the table, in full
    const hero = name.startsWith('npc_dota_hero_') ? name : `npc_dota_hero_${name}`;
    const game = gamePath();
    if (!game) return null;
    const text = vanilla();
    const ix = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
    let body = normalizeAssetPath(heroModelPath(ix, hero));
    const parts: { slot: string; name: string; model: string; skin: number; fx: string[] }[] = [];
    const modifiers: string[] = [];
    // a persona's own slot is worn under a plain one, and wears the persona's stock item until a pick
    const given = new Map((personaLayouts(text).get(hero.replace(/^npc_dota_hero_/, ''))?.parts || []).map((x) => [x.slot, x.given?.id]));
    for (const s of slots) {
      const rec = library.list().find((r) => r.categoryId === 'cosmetic' && r.slot === s.slot && r.enabled !== false && r.itemId);
      const stockItem = findItem(text, given.get(s.slot.split(':').pop() || '') || s.stock);
      const stock = stockItem ? itemFields(text, stockItem) : null;
      const picked = rec ? itemModel(text, String(rec.itemId), rec.effectId as string | undefined, hero, stock?.get('model_player') || null) : null;
      const block = rec ? findItem(text, String(rec.itemId)) : null;
      const swap = picked?.body || (block ? entityModel(block.text, hero) : null);
      if (swap) body = normalizeAssetPath(swap);
      if (block) modifiers.push(...itemActivities(block.text));
      const model = picked?.model || stock?.get('model_player');
      // the item's own particles, or the stock item's where nothing is picked (src/particle-spec.ts)
      const fx = itemParticles((block || stockItem)?.text || '');
      const worn = block || stockItem;
      const visuals = worn ? itemVisuals(text, worn) : null;
      const skin = visuals ? wornSkin(withStyle(visuals, styleOf(String(rec?.effectId || ''))).visuals) : 0;
      if (model) parts.push({ slot: s.slot, name: rec?.name || stock?.get('name') || '', model: normalizeAssetPath(model), skin, fx });
    }
    // the loadout the game plays for what is worn (src/model-loadout.ts), read out of the body itself
    const seqs = modelSequences(ix.read(body.replace(/\.vmdl$/i, '.vmdl_c')));
    const clip = loadoutSequence(seqs, modifiers);
    const idle = idleSequence(seqs) || IDLE;
    // the game's own staging (src/hero-showcase.ts): an arcana's body has an entry of its own
    const script = ix.read(`scripts/npc/heroes/${hero}.txt`)?.toString('utf8') ?? null;
    const stage = heroStage(ix.read('scripts/npc/portraits_showcase.txt')?.toString('utf8') ?? null, script, [body, hero]);
    return { body, clip, idle, motions: motionList(seqs, modifiers, itemModifiers(text)), stage, parts, heroFx: script ? heroLoadoutParticles(script) : [], read: (f) => ix.read(f) };
  }

  /** The body with its loadout clip and its idle, and each slot's model, as GLB bytes with their pictures inside. */
  async function models(hero: string, slots: PreviewSlot[], hasTool: boolean): Promise<HeroModels> {
    if (!hasTool) return { ok: false, reason: 'no-tool' };
    let p: ReturnType<typeof plan>;
    try { p = plan(hero, slots); } catch (err) { log(`preview 3d: ${(err as Error)?.message || err}`); return { ok: false, reason: 'no-body' }; }
    if (!p) return { ok: false, reason: 'no-game' };
    const bodyFile = (await glb.glbs([p.body], p.clip && p.clip !== p.idle ? [p.clip, p.idle] : [p.idle]))[p.body];
    if (!bodyFile) return { ok: false, reason: 'no-body' };
    const pedestal = p.stage.pedestal;
    const files = await glb.glbs([...p.parts.map((x) => x.model), ...(pedestal ? [pedestal] : [])]);
    const missing: string[] = [];
    const parts: { slot: string; name: string; glb: Uint8Array; attachments: Attachment[] }[] = [];
    const particles: { part: number; def: ParticleDef }[] = [];
    // one budget for every system the hero brings: a few dozen is what the window plays smoothly
    const budget = { left: 48 };
    const fx = (part: number, paths: string[]) => {
      for (const path of paths) {
        const def = particleDef(p.read, path, budget);
        if (def) particles.push({ part, def });
      }
    };
    for (const x of p.parts) {
      const worn = x.skin && glb.skinned ? await glb.skinned(x.model, x.skin, p.read(x.model.replace(/\.vmdl$/i, '.vmdl_c'))) : null;
      const f = worn || files[x.model];
      if (!f) { missing.push(x.name || x.model); continue; }
      parts.push({ slot: x.slot, name: x.name, glb: embedGlb(f), attachments: modelAttachments(p.read(x.model.replace(/\.vmdl$/i, '.vmdl_c'))) });
      fx(parts.length - 1, x.fx);
    }
    fx(-1, p.heroFx);
    const stand = pedestal ? files[pedestal] : null;
    const sprites = await spritesOf(particles.map((x) => x.def));
    return {
      ok: true, body: embedGlb(bodyFile), clip: p.clip, model: p.body, motions: p.motions, stage: p.stage, pedestal: stand ? embedGlb(stand) : null, parts, missing,
      attachments: modelAttachments(p.read(p.body.replace(/\.vmdl$/i, '.vmdl_c'))), particles, sprites,
    };
  }

  /** Every clip of a body as GLB bytes, without its pictures: the window lays them over the model it has. Null where the game has none. */
  async function motions(body: string): Promise<Uint8Array | null> {
    const got = (await glb.glbs([body], 'all'))[body];
    return got ? fs.readFileSync(got) : null;
  }

  /** The textures these systems draw with, as the window takes them. */
  async function spritesOf(defs: ParticleDef[]): Promise<Record<string, Uint8Array>> {
    const wanted = [...new Set(defs.flatMap(particleTextures))];
    const got = wanted.length && glb.sprites ? await glb.sprites(wanted) : {};
    return Object.fromEntries(Object.entries(got).filter((e): e is [string, Buffer] => !!e[1]).map(([k, v]) => [k, new Uint8Array(v)]));
  }

  /** An effect the builder offers (one of its own, or the game's unusual-<n>) as its particle system, for its picture. */
  async function effect(id: string): Promise<{ def: ParticleDef; sprites: Record<string, Uint8Array> } | null> {
    const game = gamePath();
    const fx = ITEM_EFFECTS.find((e) => e.id === id) || unusualItemEffect(vanilla(), id);
    if (!game || !fx) return null;
    const ix = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
    const def = particleDef((f) => ix.read(f), fx.modifier.toLowerCase());
    return def ? { def, sprites: await spritesOf([def]) } : null;
  }

  /** One model alone, a map prop's or a tower look's, for a picture of it, as GLB bytes with its pictures inside; null where the game has none. */
  async function model(file: string): Promise<Uint8Array | null> {
    if (!/^models\/(props_|items\/world\/)[\w/.-]+\.vmdl$/i.test(file)) return null;
    const got = (await glb.glbs([file]))[file];
    return got ? embedGlb(got) : null;
  }

  return { plan, models, motions, effect, model, sprites: spritesOf };
}

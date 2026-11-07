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
import { loadoutModels, loadoutResources } from './loadout-resources.ts';
import { hidePreviewOnlyMeshes, selectStyleMeshes, styleFamily } from './model-style-meshes.ts';
import { snapshotFromModel } from './model-snapshot-fallback.ts';
import { styleParticleRoots } from './hero-particle-styles.ts';
import type { LoadoutResources } from '../renderer/api/preview3d.ts';
import { findItem, itemFields } from './schema.ts';
import { itemVisuals } from './item-builder.ts';
import { heroModelPath, normalizeAssetPath } from './item-builder-assets.ts';
import { styleOf, withStyle } from './item-builder-styles.ts';
import { sharedVpkIndex } from './vpk.ts';
import { personaLayouts } from './item-builder-personas.ts';
import { pickModels } from './item-builder-refits.ts';
import { modelParticleEntries } from './model-particles.ts';
import { hiddenMeshes } from './model-bodygroups.ts';
import { ITEM_EFFECTS } from './item-builder-effects.ts';
import { unusualItemEffect } from './item-builder-unusual.ts';
import { idleSequence, itemActivities, itemModifiers, loadoutSequence, modelSequences, motionList, wearableClip, type Motion } from './model-loadout.ts';
import { heroStage, type HeroStage } from './hero-showcase.ts';
import { unusualEffects } from './unusual-effects.ts';
import { bindItemParticle, particleReport, heroLoadoutParticles, itemParticles, modelAttachments, particleDef, particleTextures, type Attachment, type ParticleDef } from './particle-spec.ts';
import type { createModelGlb } from './model-glb.ts';
import type { Library } from './library.ts';

import { entityModel, itemModel, monkeyKingCrown, previewStockHead, previewParticleReader, previewParticleReplacements, wornExtras, wornSkin } from './hero-preview-picks.ts';

export { entityModel, wornExtras, wornSkin } from './hero-preview-picks.ts';

/** A slot of the hero as the window names it: its id and the stock item it dresses. */
export type PreviewSlot = { slot: string; stock: string };

/** What the window gets: each model's bytes, or why there are none. */
export type HeroModels =
  | {
    ok: true; body: Uint8Array; clip: string | null; stage: HeroStage; pedestal: Uint8Array | null;
    /** the body's model path, for `motions`, and what else it can be shown doing */
    model: string; motions: Motion[];
    parts: { slot: string; name: string; glb: Uint8Array; attachments: Attachment[]; hidden: string[] }[]; missing: string[];
    /** the body's meshes the items worn turn off */
    hidden: string[];
    /** the body's attachment points, and the particles: on the body (part -1) or on a part, by its place in `parts` */
    attachments: Attachment[]; particles: { part: number; def: ParticleDef }[];
    /** the particles' textures as PNG bytes, by the path they name (src/model-glb.ts sprites) */
    sprites: Record<string, Uint8Array>; resources?: LoadoutResources;
  }
  | { ok: false; reason: 'no-game' | 'no-tool' | 'no-body' };

/** The clip a body without a loadout sequence stands in (Lone Druid, Magnus). */
const IDLE = 'idle';

/** The 3D preview's models, made on demand. */
export function createHeroPreview({ glb, library, gamePath, vanilla, log = () => {} }: {
  glb: Pick<ReturnType<typeof createModelGlb>, 'glbs'> & Partial<Pick<ReturnType<typeof createModelGlb>, 'sprites' | 'skinned'>>;
  library: Pick<Library, 'list'>;
  gamePath: () => string | null;
  vanilla: () => string;
  log?: (msg: string) => void;
}) {
  let preparedModels = new Map<string, Buffer>();
  function plan(name: string, slots: PreviewSlot[]): {
    body: string; bodySkin: number; bodyFx: string[]; replacements: Map<string, string>; clip: string | null; idle: string; motions: Motion[]; stage: HeroStage; heroFx: string[]; bindings: Map<string, ReturnType<typeof unusualEffects>[number]>; read: (p: string) => Buffer | null;
    parts: { slot: string; name: string; model: string; skin: number; style?: number; explicitBaseStyle?: boolean; fx: string[]; replacements?: Map<string, string>; clip: string | null; hidden: string[] }[];
    /** the body's meshes the items worn turn off */
    hidden: string[];
  } | null {
    const hero = name.startsWith('npc_dota_hero_') ? name : `npc_dota_hero_${name}`;
    const game = gamePath();
    if (!game) return null;
    const text = vanilla();
    const ix = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
    let body = normalizeAssetPath(heroModelPath(ix, hero));
    const parts: { slot: string; name: string; model: string; skin: number; style?: number; explicitBaseStyle?: boolean; fx: string[]; replacements?: Map<string, string>; clip: string | null; hidden: string[] }[] = [];
    const hides = new Map<string, Map<string, number>>();
    const modifiers: string[] = [], bodyFx: string[] = [];
    const replacements = new Map<string, string>();
    let authoredBodySkin: number | undefined;
    const swaps = new Map<string, Map<string, string>>();
    const given = new Map((personaLayouts(text).get(hero.replace(/^npc_dota_hero_/, ''))?.parts || []).map((x) => [x.slot, x.given?.id]));
    const equipped = library.list().filter((r) => r.categoryId === 'cosmetic' && r.enabled !== false && r.itemId);
    const crown = monkeyKingCrown(text, hero, equipped);
    const arcana = crown && equipped.find(row => String(row.itemId) === '9050');
    const rows = slots.map((s) => {
      const rec = equipped.find((r) => r.slot === s.slot);
      const stockItem = (!rec && s.slot.endsWith(':head') && crown) || findItem(text, given.get(s.slot.split(':').pop() || '') || s.stock);
      const stock = stockItem ? itemFields(text, stockItem) : null;
      const picked = rec ? itemModel(text, String(rec.itemId), rec.effectId as string | undefined, hero, stock?.get('model_player') || null) : null;
      const block = rec ? findItem(text, String(rec.itemId)) : null;
      const worn = block || stockItem;
      const visuals = worn ? itemVisuals(text, worn) : null;
      const rawModel = picked?.model || stock?.get('model_player') || '';
      const chosenStyle = styleOf(String(rec?.effectId ?? (stockItem === crown ? arcana?.effectId : '') ?? ''));
      const explicitBaseStyle = /(?:^|,)style-0(?:,|$)/.test(String(rec?.effectId || ''));
      return { s, rec, stock, picked, block, worn, visuals, rawModel, chosenStyle, explicitBaseStyle };
    });
    const familyStyles = new Map<string, number>();
    for (const row of rows) {
      const family = styleFamily(row.rawModel);
      if (family && row.chosenStyle > 0) familyStyles.set(family, row.chosenStyle);
    }
    for (const row of rows) {
      const { s, rec, stock, picked, block, worn, visuals, rawModel, explicitBaseStyle } = row;
      const family = styleFamily(rawModel);
      const chosenStyle = explicitBaseStyle ? 0 : row.chosenStyle || familyStyles.get(family) || 0;
      const styled = visuals ? withStyle(visuals, chosenStyle) : null;
      const model = styled?.model && /\.vmdl$/i.test(styled.model) ? styled.model : rawModel;
      const ioBody = hero === 'npc_dota_hero_wisp' && !!rec && /\/(?:io_ti7|io_calavera|dark_carnival_io)\.vmdl$/i.test(normalizeAssetPath(model));
      const bodySlot = s.slot.endsWith(':hero_base');
      const swap = (styled && entityModel(styled.visuals, hero)) || picked?.body || (ioBody || (bodySlot && rec) ? model : null);
      if (swap) body = normalizeAssetPath(swap);
      if (block) modifiers.push(...itemActivities(styled?.applied ? styled.visuals : block.text));
      const fx = itemParticles(styled?.applied ? styled.visuals : picked?.block || worn?.text || '');
      const fallbackSkin = Number(worn && itemFields(text, worn).get('skin')) || 0;
      const skin = styled ? wornSkin(styled.visuals, fallbackSkin) : fallbackSkin;
      const styleInfo = chosenStyle > 0 ? { style: chosenStyle } : explicitBaseStyle ? { explicitBaseStyle: true } : {};
      if (bodySlot || swap || ioBody) {
        if (styled) for (const [from, to] of previewParticleReplacements(styled.visuals)) replacements.set(from, to);
        if (ioBody) for (const [from, to] of picked?.replacements ?? []) replacements.set(from, to);
        if (rec && (bodySlot || swap)) authoredBodySkin = wornSkin(styled?.visuals ?? '', fallbackSkin || (String(rec.itemId) === '7247' ? chosenStyle : 0));
      }
      if (!model || ioBody || bodySlot || normalizeAssetPath(model) === body) bodyFx.push(...fx);
      else parts.push({ slot: s.slot, name: rec?.name || stock?.get('name') || '', model: normalizeAssetPath(model), skin, ...styleInfo, fx, ...(picked?.replacements?.size ? { replacements: picked.replacements } : {}), clip: null, hidden: [] });
      const also = worn ? wornExtras(styled?.visuals || visuals || worn.text) : { models: [], groups: [] };
      for (const extra of also.models) parts.push({ slot: s.slot, name: rec?.name || stock?.get('name') || '', model: extra, skin: 0, ...styleInfo, fx: [], clip: null, hidden: [] });
      for (const g of also.groups) hides.set(g.model, (hides.get(g.model) ?? new Map()).set(g.group, g.value));
      if (rec) swaps.set(s.slot, pickModels(text, String(rec.itemId), rec.effectId as string | undefined)?.swaps ?? new Map());
    }
    const headSlot = slots.find(slot => slot.slot.endsWith(':head'));
    const stockHead = previewStockHead(text, hero, body, ix, !!headSlot && equipped.some(row => row.slot === headSlot.slot));
    if (stockHead && !parts.some(part => part.slot.endsWith(':body_head') || part.model === stockHead)) parts.push({ slot: 'body_head', name: 'Head', model: stockHead, skin: 0, fx: [], clip: null, hidden: [] });
    const bodyFamily = styleFamily(body);
    const bodySkin = bodyFamily && familyStyles.has(bodyFamily) ? familyStyles.get(bodyFamily)! : authoredBodySkin ?? 0;
    for (const x of parts) {
      for (const [slot, made] of swaps) if (slot !== x.slot) x.model = normalizeAssetPath(made.get(x.model) || x.model);
      const file = ix.read(x.model.replace(/\.vmdl$/i, '.vmdl_c'));
      x.clip = wearableClip(modelSequences(file));
      const off = hides.get(x.model);
      if (off && file) x.hidden = hiddenMeshes(file, off);
    }
    const bodyFile = ix.read(body.replace(/\.vmdl$/i, '.vmdl_c'));
    const bodyOff = hides.get(body);
    const hidden = bodyOff && bodyFile ? hiddenMeshes(bodyFile, bodyOff) : [];
    const seqs = modelSequences(ix.read(body.replace(/\.vmdl$/i, '.vmdl_c')));
    const clip = loadoutSequence(seqs, modifiers) ?? (hero === 'npc_dota_hero_wisp' ? wearableClip(seqs) : null);
    const idle = idleSequence(seqs) || IDLE;
    const script = ix.read(`scripts/npc/heroes/${hero}.txt`)?.toString('utf8') ?? null;
    const stage = heroStage(ix.read('scripts/npc/portraits_showcase.txt')?.toString('utf8') ?? null, script, [body, hero]);
    const bindings = new Map(unusualEffects(text).map((effect) => [effect.system.toLowerCase(), effect]));
    return { body, bodySkin, bodyFx, replacements, clip, idle, bindings, motions: motionList(seqs, modifiers, itemModifiers(text)), stage, parts, hidden, heroFx: script ? heroLoadoutParticles(script) : [], read: (f) => ix.read(f) };
  }

  async function models(hero: string, slots: PreviewSlot[], hasTool: boolean): Promise<HeroModels> {
    if (!hasTool) return { ok: false, reason: 'no-tool' };
    let p: ReturnType<typeof plan>;
    try { p = plan(hero, slots); } catch (err) { log(`preview 3d: ${(err as Error)?.message || err}`); return { ok: false, reason: 'no-body' }; }
    if (!p) return { ok: false, reason: 'no-game' };
    const bodyClips = p.clip && p.clip !== p.idle ? [p.clip, p.idle] : [p.idle];
    const bodyFile = (await glb.glbs([p.body], bodyClips))[p.body];
    if (!bodyFile) return { ok: false, reason: 'no-body' };
    const styledBodyFile = p.bodySkin && glb.skinned
      ? await glb.skinned(p.body, p.bodySkin, p.read(p.body.replace(/\.vmdl$/i, '.vmdl_c')), p.clip) : null;
    const pedestal = p.stage.pedestal;
    const files = await glb.glbs([...p.parts.filter((x) => !x.clip).map((x) => x.model), ...(pedestal ? [pedestal] : [])]);
    for (const clip of new Set(p.parts.flatMap((x) => x.clip ?? []))) Object.assign(files, await glb.glbs(p.parts.filter((x) => x.clip === clip).map((x) => x.model), [clip]));
    const missing: string[] = [];
    const parts: { slot: string; name: string; glb: Uint8Array; attachments: Attachment[]; hidden: string[] }[] = [];
    const modelInputs = [{ file: styledBodyFile || bodyFile, model: p.body }];
    const styles: number[] = [];
    const particles: { part: number; def: ParticleDef }[] = [];
    const budget = { left: 256 };
    const bodyRoots = new Set<string>(), readParticle = previewParticleReader(p.read, p.replacements);
    const fx = (part: number, paths: string[]) => {
      for (const root of paths) {
        const particle = p.replacements.get(root) ?? root;
        if (bodyRoots.has(particle)) continue;
        bodyRoots.add(particle);
        const def = particleDef(readParticle, particle, budget);
        if (def) particles.push({ part, def: bindItemParticle(def, p.bindings.get(particle) ?? p.bindings.get(root), 'preview') });
      }
    };
    for (const x of p.parts) {
      const worn = x.skin && glb.skinned ? await glb.skinned(x.model, x.skin, p.read(x.model.replace(/\.vmdl$/i, '.vmdl_c')), x.clip) : null;
      const f = worn || files[x.model];
      if (!f) { missing.push(x.name || x.model); continue; }
      const model = p.read(x.model.replace(/\.vmdl$/i, '.vmdl_c'));
      const attachments = modelAttachments(model);
      modelInputs.push({ file: f, model: x.model });
      styles.push(x.style ?? 0);
      parts.push({ slot: x.slot, name: x.name, glb: Buffer.alloc(0), attachments, hidden: x.hidden });
      const index = parts.length - 1;
      const roots = styleParticleRoots(modelParticleEntries(model), x.fx, x.style ?? 0);
      const resolved = new Set<string>(), readPart = previewParticleReader(p.read, p.replacements, x.replacements);
      for (const [path, config] of roots) {
        const replacement = x.replacements?.get(path) ?? p.replacements.get(path) ?? path;
        if (resolved.has(replacement)) continue;
        resolved.add(replacement);
        const def = particleDef(readPart, replacement, budget);
        if (def) particles.push({ part: index, def: bindItemParticle(def, p.bindings.get(replacement) ?? p.bindings.get(path), config) });
      }
      if (process.env.MM_PREVIEW_FX) log(`preview fx: ${JSON.stringify({
        slot: x.slot, model: x.model, attachments: attachments.map((a) => [a.name, a.bone]),
        requested: [...resolved], loaded: particles.filter((entry) => entry.part === index).map(({ def }) => particleReport(def)),
      })}`);
    }
    fx(-1, modelParticleEntries(p.read(p.body.replace(/\.vmdl$/i, '.vmdl_c'))).map((entry) => entry.path));
    fx(-2, [...p.bodyFx, ...p.heroFx]);
    if (!particles.length && /\/wisp\/wisp\.vmdl$/i.test(p.body)) fx(-2, ['particles/units/heroes/hero_wisp/wisp_ambient.vpcf']);
    const stand = pedestal ? files[pedestal] : null;
    const cached = preparedModels;
    const keyOf = ({ file, model }: typeof modelInputs[number]) => JSON.stringify([file, model]);
    const pending = new Map(modelInputs.map(input => [keyOf(input), input]));
    for (const key of cached.keys()) pending.delete(key);
    const fresh = await loadoutModels([...pending.values()], p.read, glb);
    const loaded = new Map([...pending.keys()].map((key, i) => [key, fresh[i]!]));
    const next = new Map<string, Buffer>();
    let bytes = 0;
    const [body, ...wearables] = modelInputs.map(input => {
      const key = keyOf(input);
      const model = loaded.get(key) ?? cached.get(key)!;
      if (!next.has(key) && bytes + model.byteLength <= 64 * 1024 * 1024) {
        next.set(key, model);
        bytes += model.byteLength;
      }
      return model;
    });
    preparedModels = next;
    parts.forEach((part, index) => { part.glb = selectStyleMeshes(wearables[index]!, styles[index]); });
    const definitions = particles.map(x => x.def), resources = await resourcesOf(definitions);
    if (hero.replace(/^npc_dota_hero_/, '') === 'phantom_assassin') {
      const weapon = parts.find(part => part.slot.endsWith(':weapon'))?.glb;
      const recovered = new Set<string>();
      for (const missing of resources.missing) {
        const key = missing.toLowerCase();
        if (!/^particles\/models\/heroes\/phantom_assassin\/pa_arcana(?:_weapon_[ab])?\.vsnap$/.test(key)) continue;
        const from = key.endsWith('pa_arcana.vsnap') ? body : weapon;
        if (!from) continue;
        const side = key.endsWith('_weapon_a.vsnap') ? 'right' : key.endsWith('_weapon_b.vsnap') ? 'left' : null;
        const snapshot = snapshotFromModel(from, side);
        if (snapshot) { resources.snapshots[missing] = snapshot; recovered.add(missing); }
      }
      if (recovered.size) resources.missing = resources.missing.filter(path => !recovered.has(path));
    }
    const sprites = await spritesOf(definitions, resources);
    return {
      ok: true, body: hidePreviewOnlyMeshes(body!), clip: p.clip, model: p.body, motions: p.motions, stage: p.stage, pedestal: stand ? embedGlb(stand) : null, parts, missing, hidden: p.hidden,
      attachments: modelAttachments(p.read(p.body.replace(/\.vmdl$/i, '.vmdl_c'))), particles, sprites, resources,
    };
  }
  /** Every clip of a body as GLB bytes, without its pictures: the window lays them over the model it has. Null where the game has none. */
  async function motions(body: string): Promise<Uint8Array | null> {
    const got = (await glb.glbs([body], 'all'))[body];
    return got ? fs.readFileSync(got) : null;
  }
  /** The textures these systems draw with, as the window takes them. */
  async function spritesOf(defs: ParticleDef[], res?: LoadoutResources): Promise<Record<string, Uint8Array>> {
    res ??= await resourcesOf(defs);
    const wanted = [...new Set([...defs.flatMap(particleTextures), ...Object.keys(res.sheets), ...Object.values(res.materials).flatMap(m => Object.values(m.textures))])];
    const got = wanted.length && glb.sprites ? await glb.sprites(wanted) : {};
    return Object.fromEntries(Object.entries(got).filter((e): e is [string, Buffer] => !!e[1]).map(([k, v]) => [k, new Uint8Array(v)]));
  }

  const resourceCache = new WeakMap<ParticleDef[], Promise<LoadoutResources>>();
  function resourcesOf(defs: ParticleDef[]): Promise<LoadoutResources> {
    const game = gamePath();
    if (!game) return Promise.resolve({ snapshots: {}, materials: {}, models: {}, sheets: {}, missing: [] });
    const ix = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
    let result = resourceCache.get(defs);
    if (!result) { result = loadoutResources(defs, (p) => ix.read(p), glb); resourceCache.set(defs, result); }
    return result;
  }

  /** An effect the builder offers (one of its own, or the game's unusual-<n>) as its particle system, for its picture. */
  async function effect(id: string): Promise<{ def: ParticleDef; sprites: Record<string, Uint8Array>; resources?: LoadoutResources } | null> {
    const game = gamePath();
    const fx = ITEM_EFFECTS.find((e) => e.id === id) || unusualItemEffect(vanilla(), id);
    if (!game || !fx) return null;
    const ix = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
    const def = particleDef((f) => ix.read(f), fx.modifier.toLowerCase());
    return def ? { def, sprites: await spritesOf([def]), resources: await resourcesOf([def]) } : null;
  }

  /** One model alone, a map prop's or a tower look's, for a picture of it, as GLB bytes with its pictures inside; null where the game has none. */
  async function model(file: string): Promise<Uint8Array | null> {
    if (!/^models\/(props_|items\/world\/)[\w/.-]+\.vmdl$/i.test(file)) return null;
    const got = (await glb.glbs([file]))[file];
    return got ? embedGlb(got) : null;
  }

  return { plan, models, motions, effect, model, sprites: spritesOf, resources: resourcesOf };
}

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
import { crestActivities, goldenCrestModel, mergeCrestAttachments, normalCrestOnGoldenRig } from './razor-crest-preview.ts';
import { loadoutModels, loadoutResources, loadoutTexturePaths } from './loadout-resources.ts';
import { forParts, previewParticles } from './hero-preview-fx.ts';
import { hidePreviewOnlyMeshes, selectStyleMeshes, styleFamily } from './model-style-meshes.ts';
import { snapshotFromModel } from './model-snapshot-fallback.ts';
import type { LoadoutResources } from '../renderer/api/preview3d.ts';
import { findItem, itemFields } from './schema.ts';
import { itemVisuals } from './item-builder.ts';
import { heroModelPath, normalizeAssetPath } from './item-builder-assets.ts';
import { styleOf, withStyle } from './item-builder-styles.ts';
import { sharedVpkIndex } from './vpk.ts';
import { personaLayouts } from './item-builder-personas.ts';
import { pickModels } from './item-builder-refits.ts';
import { hiddenMeshes } from './model-bodygroups.ts';
import { ITEM_EFFECTS } from './item-builder-effects.ts';
import { effectsOf, unusualItemEffect } from './item-builder-unusual.ts';
import { idleSequence, itemModifiers, loadoutSequence, modelSequences, motionList, wearableClip, type Motion } from './model-loadout.ts';
import { heroStage, type HeroStage } from './hero-showcase.ts';
import type { UnusualEffect } from './unusual-effects.ts';
import { itemParticles, modelAttachments, particleDef, particleTextures, type Attachment, type ParticleDef } from './particle-spec.ts';
import type { createModelGlb } from './model-glb.ts';
import type { Library } from './library.ts';
import { bodySkinFor, entityModel, itemModel, monkeyKingCrown, personaPreviewSlots, previewEquipment, previewBladeReplacements, previewCrestParticles, previewHeroParticles, previewStockHead, previewParticleReplacements, wornExtras, wornSkin } from './hero-preview-picks.ts';

export { entityModel, wornExtras, wornSkin } from './hero-preview-picks.ts';
/** A preview slot with its stock item and an optional unsaved selection. */
export type PreviewSlot = { slot: string; stock: string; tryOn?: { itemId: string; effectId: string } };

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
  const preparedModels = new Map<string, Buffer>();
  function plan(name: string, slots: PreviewSlot[]): {
    body: string; bodySkin: number; bodyFx: string[]; replacements: Map<string, string>; clip: string | null; idle: string; motions: Motion[]; stage: HeroStage; heroFx: string[]; bindings: Map<string, UnusualEffect>; read: (p: string) => Buffer | null;
    parts: { slot: string; name: string; model: string; skin: number; style?: number; explicitBaseStyle?: boolean; crestRig?: string; fx: string[]; replacements?: Map<string, string>; clip: string | null; hidden: string[] }[];
    /** the body's meshes the items worn turn off */
    hidden: string[];
  } | null {
    const hero = name.startsWith('npc_dota_hero_') ? name : `npc_dota_hero_${name}`;
    const game = gamePath();
    if (!game) return null;
    const text = vanilla();
    const ix = sharedVpkIndex(path.join(game, 'dota', 'pak01_dir.vpk'));
    let body = normalizeAssetPath(heroModelPath(ix, hero));
    const parts: { slot: string; name: string; model: string; skin: number; style?: number; explicitBaseStyle?: boolean; crestRig?: string; fx: string[]; replacements?: Map<string, string>; clip: string | null; hidden: string[] }[] = [];
    const hides = new Map<string, Map<string, number>>();
    const modifiers: string[] = [], bodyFx: string[] = [];
    const replacements = new Map<string, string>();
    let authoredBodySkin: number | undefined; const bodySkinVisuals: { visuals: string; item: string }[] = [];
    const swaps = new Map<string, Map<string, string>>();
    const given = new Map((personaLayouts(text).get(hero.replace(/^npc_dota_hero_/, ''))?.parts || []).map((x) => [x.slot, x.given?.id]));
    const installed = library.list().filter((r) => r.categoryId === 'cosmetic' && r.enabled !== false && r.itemId);
    const equipped = previewEquipment(text, installed, slots); slots = personaPreviewSlots(text, hero, slots, equipped);
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
      if (rec && styled?.visuals) bodySkinVisuals.push({ visuals: styled.visuals, item: String(rec.itemId) });
      if (block) modifiers.push(...crestActivities(text, String(rec?.itemId), styled?.applied ? styled.visuals : block.text), ...(String(rec?.itemId) === '7571' ? ['aeons'] : []));
      const fx = previewCrestParticles(itemParticles(styled?.applied ? styled.visuals : picked?.block || worn?.text || ''), model, String(rec?.itemId ?? ''), ix);
      const fallbackSkin = Number(worn && itemFields(text, worn).get('skin')) || 0;
      const skin = styled ? wornSkin(styled.visuals, fallbackSkin, normalizeAssetPath(model)) : fallbackSkin;
      const styleInfo = chosenStyle > 0 ? { style: chosenStyle } : explicitBaseStyle ? { explicitBaseStyle: true } : {};
      if (bodySlot || swap || ioBody || String(rec?.itemId) === '34368') {
        if (styled) for (const [from, to] of previewParticleReplacements(styled.visuals)) replacements.set(from, to);
        if (ioBody) for (const [from, to] of picked?.replacements ?? []) replacements.set(from, to);
        if (rec && (bodySlot || swap)) authoredBodySkin = wornSkin(styled?.visuals ?? '', fallbackSkin || (String(rec.itemId) === '7247' ? chosenStyle : 0));
      }
      if (!model || ioBody || bodySlot || normalizeAssetPath(model) === body) bodyFx.push(...fx);
      else parts.push({ slot: s.slot, name: rec?.name || stock?.get('name') || '', model: normalizeAssetPath(model), skin, ...(String(rec?.itemId) === '6646' ? { crestRig: goldenCrestModel(text, normalizeAssetPath(model), '6646') } : {}), ...styleInfo, fx, ...(hero === 'npc_dota_hero_terrorblade' && s.slot.endsWith(':weapon')
        ? { replacements: previewBladeReplacements(picked?.replacements, styled?.visuals) }
        : picked?.replacements?.size ? { replacements: picked.replacements } : {}), clip: null, hidden: [] });
      const also = worn ? wornExtras(styled?.visuals || visuals || worn.text) : { models: [], groups: [] };
      for (const extra of also.models) parts.push({ slot: s.slot, name: rec?.name || stock?.get('name') || '', model: extra, skin: 0, ...styleInfo, fx: [], clip: null, hidden: [] });
      for (const g of also.groups) hides.set(g.model, (hides.get(g.model) ?? new Map()).set(g.group, g.value));
      if (rec) swaps.set(s.slot, pickModels(text, String(rec.itemId), rec.effectId as string | undefined)?.swaps ?? new Map());
    }
    for (const made of swaps.values()) if (made.has(body)) { body = made.get(body)!; break; }
    const headSlot = slots.find(slot => slot.slot.endsWith(':head'));
    const stockHead = previewStockHead(text, hero, body, ix, !!headSlot && equipped.some(row => row.slot === headSlot.slot));
    if (stockHead && !parts.some(part => part.slot.endsWith(':body_head') || part.model === stockHead)) parts.push({ slot: 'body_head', name: 'Head', model: stockHead, skin: 0, fx: [], clip: null, hidden: [] });
    const bodyFamily = styleFamily(body);
    const targetedSkin = bodySkinVisuals.reduce<number | undefined>((skin, { visuals, item }) => bodySkinFor(visuals, hero, body, hero === 'npc_dota_hero_primal_beast' && item === '24736') ?? skin, undefined);
    const bodySkin = targetedSkin ?? (bodyFamily && familyStyles.has(bodyFamily) ? familyStyles.get(bodyFamily)! : authoredBodySkin ?? 0);
    for (const x of parts) {
      for (const [slot, made] of swaps) if (slot !== x.slot) x.model = normalizeAssetPath(made.get(x.model) || x.model);
      const file = ix.read(x.model.replace(/\.vmdl$/i, '.vmdl_c'));
      x.clip = wearableClip(modelSequences(file));
      const off = hides.get(x.model);
      if (off && file) x.hidden = hiddenMeshes(file, off);
    }
    const bodyFile = ix.read(body.replace(/\.vmdl$/i, '.vmdl_c')), bodyOff = hides.get(body);
    const hidden = bodyOff && bodyFile ? hiddenMeshes(bodyFile, bodyOff) : [];
    const seqs = modelSequences(bodyFile);
    const clip = loadoutSequence(seqs, modifiers) ?? (hero === 'npc_dota_hero_wisp' ? wearableClip(seqs) : null);
    const idle = idleSequence(seqs) || IDLE;
    const script = ix.read(`scripts/npc/heroes/${hero}.txt`)?.toString('utf8') ?? null;
    const stage = heroStage(ix.read('scripts/npc/portraits_showcase.txt')?.toString('utf8') ?? null, script, [body, hero]);
    const bindings = new Map(effectsOf(text).map((effect) => [effect.system.toLowerCase(), effect]));
    if (hero === 'npc_dota_hero_razor' && process.env.MM_PREVIEW_FX) log(`razor preview plan: ${JSON.stringify({ body, clip, idle, modifiers, head: parts.filter(part => part.slot.endsWith(':head')) })}`);
    return { body, bodySkin, bodyFx, replacements, clip, idle, bindings, motions: motionList(seqs, modifiers, itemModifiers(text)), stage, parts, hidden, heroFx: previewHeroParticles(script, hero, !rows.some(row => row.s.slot.endsWith(':weapon') && row.rec), ix), read: (f) => ix.read(f) };
  }
  async function models(hero: string, slots: PreviewSlot[], hasTool: boolean): Promise<HeroModels> {
    if (!hasTool) return { ok: false, reason: 'no-tool' };
    let p: ReturnType<typeof plan>;
    try { p = plan(hero, slots); } catch (err) { log(`preview 3d: ${(err as Error)?.message || err}`); return { ok: false, reason: 'no-body' }; }
    if (!p) return { ok: false, reason: 'no-game' };
    const bodyClips = p.clip && p.clip !== p.idle ? [p.clip, p.idle] : [p.idle];
    // out of the game's files alone, so they fetch while the models export: the materials' pictures,
    // and the particles with the models and pictures they name (src/hero-preview-fx.ts)
    if (glb.sprites) void glb.sprites(loadoutTexturePaths([p.body, ...p.parts.map((x) => x.model)], p.read)).catch(() => {});
    const planned = previewParticles(p, log), early = resourcesOf(planned.map((x) => x.def));
    if (glb.sprites) void glb.sprites([...new Set(planned.flatMap((x) => particleTextures(x.def)))]).catch(() => {});
    const earlySprites = early.then((res) => spritesOf(planned.map((x) => x.def), res));
    earlySprites.catch(() => {});
    const pedestal = p.stage.pedestal;
    const [bodyFiles, styledBodyFile, files, ...clipFiles] = await Promise.all([
      glb.glbs([p.body], bodyClips),
      p.bodySkin && glb.skinned ? glb.skinned(p.body, p.bodySkin, p.read(p.body.replace(/\.vmdl$/i, '.vmdl_c')), bodyClips) : null,
      glb.glbs([...p.parts.filter((x) => !x.clip).map((x) => x.model), ...p.parts.flatMap(x => x.crestRig ? [x.crestRig] : []), ...(pedestal ? [pedestal] : [])]),
      ...[...new Set(p.parts.flatMap((x) => x.clip ?? []))].map((clip) => glb.glbs(p.parts.filter((x) => x.clip === clip).map((x) => x.model), [clip])),
    ]);
    const bodyFile = bodyFiles[p.body]; if (!bodyFile) return { ok: false, reason: 'no-body' };
    const skinnedParts = await Promise.all(p.parts.map((x) => x.skin && glb.skinned ? glb.skinned(x.model, x.skin, p.read(x.model.replace(/\.vmdl$/i, '.vmdl_c')), x.clip) : null));
    const missing: string[] = [];
    const parts: { slot: string; name: string; glb: Uint8Array; attachments: Attachment[]; hidden: string[] }[] = [];
    const modelInputs = [{ file: styledBodyFile || bodyFile, model: p.body, skin: p.bodySkin }];
    const styles: number[] = [], crestRigs: { file: string; model: string }[] = [];
    // each part of the plan's place among those that exported, -1 for one that did not
    const placed: number[] = [];
    for (const [i, x] of p.parts.entries()) {
      const f = skinnedParts[i] || files[x.model] || clipFiles.find((got) => got[x.model])?.[x.model];
      if (!f) { missing.push(x.name || x.model); placed.push(-1); continue; }
      const attachments = modelAttachments(p.read(x.model.replace(/\.vmdl$/i, '.vmdl_c')));
      modelInputs.push({ file: f, model: x.model, skin: x.skin });
      styles.push(x.style ?? 0); if (x.crestRig && files[x.crestRig]) crestRigs[parts.length] = { file: files[x.crestRig]!, model: x.crestRig };
      parts.push({ slot: x.slot, name: x.name, glb: Buffer.alloc(0), attachments, hidden: x.hidden });
      placed.push(parts.length - 1);
    }
    const particles = forParts(planned, placed);
    const stand = pedestal ? files[pedestal] : null;
    const keyOf = ({ file, model, skin }: typeof modelInputs[number]) => JSON.stringify([file, model, skin]);
    const pending = new Map(modelInputs.map(input => [keyOf(input), input]));
    const cached = new Map([...pending.keys()].flatMap(key => { const bytes = preparedModels.get(key); return bytes ? [[key, bytes] as const] : []; }));
    for (const key of cached.keys()) pending.delete(key);
    // with every part in, the resources fetched early are these; else they are made again, from the cache, for those that came
    const [fresh, resources] = await Promise.all([loadoutModels([...pending.values()], p.read, glb), particles === planned ? early : resourcesOf(particles.map((x) => x.def))]);
    [...pending.keys()].forEach((key, i) => cached.set(key, fresh[i]!));
    const [body, ...wearables] = modelInputs.map(input => {
      const key = keyOf(input), model = cached.get(key)!;
      preparedModels.delete(key);
      preparedModels.set(key, model);
      return model;
    });
    let bytes = [...preparedModels.values()].reduce((total, model) => total + model.byteLength, 0);
    for (const [key, model] of preparedModels) { if (bytes <= 256 * 1024 * 1024) break; preparedModels.delete(key); bytes -= model.byteLength; }
    parts.forEach((part, index) => { const model = selectStyleMeshes(wearables[index]!, styles[index]), rig = crestRigs[index]; part.glb = (rig && normalCrestOnGoldenRig(model, rig.file)) || model; if (rig && process.env.MM_PREVIEW_FX) log(`razor preview donor: ${rig.model}, applied=${part.glb !== model}`); if (rig && part.glb !== model) part.attachments = mergeCrestAttachments(part.attachments, modelAttachments(p.read(rig.model + '_c'))); });
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
    const sprites = particles === planned ? await earlySprites : await spritesOf(particles.map((x) => x.def), resources);
    return {
      ok: true, body: hidePreviewOnlyMeshes(body!), clip: p.clip ?? p.idle, model: p.body, motions: p.motions, stage: p.stage, pedestal: stand ? embedGlb(stand) : null, parts, missing, hidden: p.hidden,
      attachments: modelAttachments(p.read(p.body.replace(/\.vmdl$/i, '.vmdl_c'))), particles, sprites, resources,
    };
  }
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

  /**
   * A slot's options exported ahead as trying each on will ask for them (its model under the same clips,
   * in one run, and its materials' pictures), so a try-on, which waited 3 to 5 s, finds them cached.
   * @param items the options' item ids, at most 40, planned one per turn of the window: forty in a row froze it (2026-11-10)
   */
  async function prefetch(hero: string, slots: PreviewSlot[], slot: string, items: string[]): Promise<number> {
    const byClip = new Map<string, Set<string>>(), all = new Set<string>();
    let read: ((path: string) => Buffer | null) | null = null;
    for (const itemId of items.slice(0, 40)) {
      let p: ReturnType<typeof plan> | null = await new Promise<null>((r) => setImmediate(() => r(null)));
      try { p = plan(hero, slots.map((s) => (s.slot === slot ? { ...s, tryOn: { itemId, effectId: '' } } : s))); } catch { continue; }
      if (!p) return 0;
      read = p.read;
      for (const x of p.parts) if (x.slot === slot) { byClip.set(x.clip ?? '', (byClip.get(x.clip ?? '') ?? new Set()).add(x.model)); all.add(x.model); }
    }
    if (!read || !all.size) return 0;
    await Promise.all([...[...byClip].map(([clip, models]) => glb.glbs([...models], clip ? [clip] : [])),
      glb.sprites?.(loadoutTexturePaths([...all], read))]);
    return all.size;
  }

  return { plan, models, motions, effect, model, prefetch, sprites: spritesOf, resources: resourcesOf };
}

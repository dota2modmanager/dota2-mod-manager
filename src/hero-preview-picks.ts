/* Equipment metadata used to build the desktop preview. */
import { blockBounds, eachChild, findItem, itemFields, listItems } from './schema.ts';
import { itemHeroes } from './item-builder-slots.ts';
import type { VpkIndex } from './vpk.ts';
import { itemEffectPatch } from './item-builder.ts';
import { normalizeAssetPath } from './item-builder-assets.ts';
export { wornSkin } from './item-builder-assets.ts';

/**
 * The model an item puts on in the style picked, and the body it swaps the hero for. The build
 * copies the item's model over the stock one (`stock`); its other copies are particles and other
 * units' models, which the hero does not wear.
 */
export function itemModel(text: string, itemId: string, key: string | undefined, hero: string, stock: string | null): { model: string | null; body: string | null; block?: string; replacements?: Map<string, string> } {
  let body: string | null = null;
  try {
    const patch = itemEffectPatch(text, itemId, key || '');
    const copies = patch.assetCopies;
    const replacements = new Map(copies.flatMap((c) => 'to' in c && /\.vpcf$/i.test(c.to)
      ? [[c.to.toLowerCase(), c.from.toLowerCase()] as const] : []));
    body = copies.find((c) => 'hero' in c && c.hero === hero)?.from ?? null;
    const own = stock ? copies.find((c) => 'to' in c && normalizeAssetPath(c.to) === normalizeAssetPath(stock))?.from : null;
    // an arcana that is the whole hero puts on nothing besides its body
    const item = findItem(text, itemId);
    const model = own || (item && itemFields(text, item).get('model_player')) || null;
    return { model, body, block: patch.block, replacements };
  } catch { /* an item the table has lost: its block's own model, if any */ }
  const item = findItem(text, itemId);
  return { model: item ? itemFields(text, item).get('model_player') || null : null, body };
}

/** A material group explicitly addressed to the hero body, even on a wearable. */
export function bodySkinFor(visuals: string, hero: string, model: string, implicitBody = false): number | undefined {
  let skin: number | undefined;
  eachChild(visuals, blockBounds(visuals, 0), modifier => {
    if (!modifier.isBlock || !/^asset_modifier\d*$/i.test(modifier.key)) return;
    const fields = new Map<string, string>();
    eachChild(visuals, modifier.body, f => { if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value); });
    const target = normalizeAssetPath(fields.get('asset')).replace(/_c$/, '');
    const value = fields.get('skin');
    if (fields.get('type')?.toLowerCase() === 'model_skin' && (fields.get('style') ?? '0') === '0' &&
        (target === hero || target === 'npc_dota_hero_' + hero || target === model || (!target && implicitBody)) && value !== undefined && /^\d+$/.test(value)) skin = Number(value);
  });
  return skin;
}

/**
 * The body an item's "entity_model" modifier puts the hero in: a persona's, which the item's own
 * copies leave out because a persona goes on through its base (src/item-builder-personas.ts).
 */
export function entityModel(block: string, hero: string): string | null {
  for (const m of block.matchAll(/"asset_modifier\d*"\s*\{([^{}]*)\}/gi)) {
    const field = (k: string) => new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(m[1])?.[1];
    if (field('type')?.toLowerCase() === 'entity_model' && (field('style') ?? '0') === '0' && field('asset') === hero && /\.vmdl$/i.test(field('modifier') || '')) return field('modifier')!;
  }
  return null;
}

/** What an item wears besides its model, in the first style: second models, and the body groups it sets. */
export function wornExtras(visuals: string): { models: string[]; groups: { model: string; group: string; value: number }[] } {
  const models: string[] = [];
  const groups: { model: string; group: string; value: number }[] = [];
  for (const m of visuals.matchAll(/"asset_modifier\d*"\s*\{([^{}]*)\}/gi)) {
    const field = (k: string) => new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(m[1])?.[1];
    if (Number(field('style') || 0) !== 0) continue;
    const type = field('type')?.toLowerCase();
    const asset = field('asset');
    if (type === 'additional_wearable' && asset) models.push(normalizeAssetPath(asset));
    if (type === 'bodygroup_visibility' && asset && field('modifier')) groups.push({ model: normalizeAssetPath(asset), group: (field('modifier') as string).toLowerCase(), value: Number(field('value')) || 0 });
  }
  return { models, groups };
}



/** The separately authored crown that accompanies Great Sage's Reckoning. */
export function monkeyKingCrown(text: string, hero: string, equipped: { itemId?: string | number | null }[]) {
  if (hero !== 'npc_dota_hero_monkey_king' || !equipped.some(row => String(row.itemId) === '9050')) return null;
  return findItem(text, '34183');
}

/** Use the selected style's replacements even when they affect a different model's ambient. */
export function previewParticleReplacements(visuals: string): Map<string, string> {
  const replacements = new Map<string, string>();
  eachChild(visuals, blockBounds(visuals, 0), modifier => {
    if (!modifier.isBlock || !/^asset_modifier\d*$/i.test(modifier.key)) return;
    const fields = new Map<string, string>();
    eachChild(visuals, modifier.body!, f => { if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value); });
    if (!['particle', 'particle_combined'].includes(fields.get('type') ?? '') || (fields.get('style') ?? '0') !== '0') return;
    const from = fields.get('asset')?.toLowerCase(), to = fields.get('modifier')?.toLowerCase();
    if (from?.endsWith('.vpcf') && to?.endsWith('.vpcf')) replacements.set(from, to);
  });
  return replacements;
}

/** Economy replacements can target a nested child as well as the equipped effect's root. */
export function previewParticleReader(read: (path: string) => Buffer | null, replacements: Map<string, string>, own?: Map<string, string>) {
  return (file: string) => {
    const key = file.replace(/_c$/i, '');
    const selected = own?.get(key) ?? replacements.get(key);
    return read(selected ? selected + '_c' : file);
  };
}

/** The hidden body_head slot supplies the face independently of a hat or hair. */
export function previewStockHead(text: string, hero: string, body: string, index: Pick<VpkIndex, 'has'>, hatEquipped = false): string | null {
  const name = hero.replace(/^npc_dota_hero_/, '');
  const splitHead = ['arc_warden', 'faceless_void', 'invoker', 'phantom_lancer', 'tinker'].includes(name);
  if (body !== `models/heroes/${name}/${name}.vmdl`) return null;
  const hasModel = (model: string) => index.has(normalizeAssetPath(model) + '_c');
  const heads = listItems(text).filter(item =>
    (item.slot === 'body_head' || (splitHead && item.slot === 'head')) && (item.baseitem || item.prefab === 'default_item')
    && item.model && item.model !== body && !/persona|hair/i.test(item.model) && itemHeroes(text, item).includes(hero)
    && hasModel(item.model));
  const head = heads.find(item => item.slot === 'body_head') ?? (!hatEquipped ? heads[0] : undefined);
  if (head) return normalizeAssetPath(head.model);
  const conventional = `models/heroes/${name}/${name}_head.vmdl`;
  // A conventional face is safe under hats only for the known independent meshes.
  return splitHead && (!hatEquipped || name === 'invoker' || name === 'phantom_lancer') && hasModel(conventional) ? conventional : null;
}

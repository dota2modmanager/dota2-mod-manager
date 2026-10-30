/**
 * A courier look's models, under the Default Courier's paths.
 *
 * A look is the paid courier's visuals copied onto Default Courier (schema baseItemPatch), and the
 * client draws its particles from that. The courier's model it does not: the server makes the unit
 * and sets its model from its own item table, where Default Courier is the donkey. So a courier
 * picked in unsafe mode came out as the donkey with the paid courier's particles on it.
 *
 * Under the donkey's paths the courier's own model is what the client loads for it, numbered as the
 * donkey is (src/model-sequences.ts), since online the server picks the animation in the donkey and
 * sends its number. A model that cannot be numbered so is left out (gameAssetEntries): the donkey
 * is better than a courier playing its death for its run.
 */
import { findItem, eachChild, blockBounds, baseItemFor, baseItemPatch, type SchemaPatch } from './schema.ts';
import { gameAssetEntries } from './item-builder-assets.ts';
import type { AssetCopy } from './item-builder-slots.ts';
import type { VpkEntry } from './vpk.ts';
import type { LibRecord } from './types.ts';

const MODEL_TYPES = new Set(['courier', 'courier_flying']);

/**
 * Each courier model swap of an item's first style, by "type|asset" (courier|radiant,
 * courier_flying|dire...), and the material set it wears them in: its first style's, else the one
 * its visuals name for every style (Collector's Baby Roshan 2018's silver is set 2).
 */
function courierModels(text: string, id: string): { models: Map<string, string>; skin: number } {
  const out = new Map<string, string>();
  let skin = 0;
  let styleSkin: number | null = null;
  const item = findItem(text, id);
  if (!item) return { models: out, skin };
  eachChild(text, blockBounds(text, item.start), (v) => {
    if (!v.isBlock || v.key.toLowerCase() !== 'visuals') return;
    eachChild(text, v.body, (c) => {
      if (!c.isBlock && c.key.toLowerCase() === 'skin') skin = Number(c.value) || 0;
      if (c.isBlock && c.key.toLowerCase() === 'styles') {
        eachChild(text, c.body, (st) => {
          if (st.isBlock && st.key === '0') eachChild(text, st.body, (f) => { if (!f.isBlock && f.key.toLowerCase() === 'skin') styleSkin = Number(f.value) || 0; });
        });
      }
      if (!c.isBlock || !/^asset_modifier\d*$/i.test(c.key)) return;
      const f = new Map<string, string>();
      eachChild(text, c.body, (x) => { if (!x.isBlock) f.set(x.key.toLowerCase(), x.value); });
      const type = (f.get('type') || '').toLowerCase();
      const style = f.get('style');
      if (!MODEL_TYPES.has(type) || !f.get('modifier') || (style && style !== '0')) return;
      const key = `${type}|${(f.get('asset') || '').toLowerCase()}`;
      if (!out.has(key)) out.set(key, f.get('modifier')!);
    });
  });
  return { models: out, skin: styleSkin ?? skin };
}

/**
 * The files a courier look puts under the base courier's models: each of the source's models goes
 * where the base has the same kind (walking, flying) for the same team, in the courier's material
 * set (src/model-skin.ts), which the server would leave at the first. Nothing for a look of any
 * other slot, which names no courier models.
 * @param targetId  the base item, Default Courier
 * @param sourceId  the courier picked
 */
export function courierCopies(text: string, targetId: string, sourceId: string): AssetCopy[] {
  const plain = courierModels(text, targetId).models;
  if (!plain.size) return [];
  const { models, skin } = courierModels(text, sourceId);
  const out: AssetCopy[] = [];
  for (const [key, from] of models) {
    const to = plain.get(key);
    if (to && (to.toLowerCase() !== from.toLowerCase() || skin)) out.push({ from, to, unit: 'courier', ...(skin ? { skin } : {}) });
  }
  return out;
}

/**
 * A look's patch: its slot's base item dressed in the picked item's visuals, and for a courier its
 * models under the base's paths. Null for a slot with no base item.
 *
 * Without the game's files to read the block still goes on, particles and all: the models are what
 * a lobby would miss, not the look.
 * @param log  a model left out, and why
 */
export function lookPatch(text: string, game: string, rec: Pick<LibRecord, 'name' | 'slot' | 'itemId'>, log: (msg: string) => void): SchemaPatch | null {
  const target = baseItemFor(text, rec.slot);
  if (!target) return null;
  const block = baseItemPatch(text, target.id, String(rec.itemId));
  const copies = courierCopies(text, target.id, String(rec.itemId));
  let assets: VpkEntry[] = [];
  try {
    if (copies.length) assets = gameAssetEntries(game, copies);
  } catch (err) {
    log(`schema: ${rec.name}: its models left out of the build: ${(err as Error)?.message || err}`);
    return { id: target.id, block, source: rec.name };
  }
  if (assets.length < copies.length) log(`schema: ${rec.name}: ${copies.length - assets.length} of its ${copies.length} models left as the plain courier`);
  return { id: target.id, block, source: rec.name, ...(assets.length ? { assets } : {}) };
}

/**
 * Refits: an item's model made again to fit a body another item gives the hero. Faceless Void's
 * arcana is a body of its own, and Valve made some thirty of his items again for it (Bracers of
 * Aeons, Jewel of Aeons, his stock bracers, belt and shoulders); the arcana's visuals name each one
 * as a "model" swap of the item's model, which the game makes while both are worn. Drow's arcana
 * does the same for her quivers and for its own set's bow, which becomes the crossbow.
 *
 * The builder puts a pick's model under its slot's stock path (src/item-builder.ts), where the
 * game's swap of the paid model never reaches it: the plain model went on the arcana's body and sat
 * wrong on it, and the arcana's refit of the stock item fought it for the same path, the first pick
 * in the library winning. The report of 2026-10-27: Void's arms, shoulders and belt broken under
 * the arcana, Drow's Dread Retribution bow gone in the menu and shrunk in a match. So the build
 * (src/schema-build.ts) gives a pick the refit any other pick makes of its model, and lets a pick's
 * own model keep its stock path over another pick's swap of the stock model there.
 */
import { findItem, itemFields, eachChild, blockBounds } from './schema.ts';
import { normalizeAssetPath } from './item-builder-assets.ts';
import { styleOf, withStyle } from './item-builder-styles.ts';
import { effectKey } from './item-builder.ts';
import { entryPath, type VpkEntry } from './vpk.ts';

/** What a pick wears, and what it makes of other items' models, as normalizeAssetPath writes them. */
export interface PickModels { model: string; swaps: Map<string, string> }

/**
 * The model a pick wears in its chosen style, and the model swaps that style makes: the ones with
 * no style or the first, as src/item-builder-assets.ts itemAssets reads them, after withStyle has
 * made the chosen one the first.
 */
export function pickModels(text: string, itemId: string, effectIds: string | string[] | null | undefined): PickModels | null {
  const item = findItem(text, itemId);
  if (!item) return null;
  let visuals: string | null = null;
  eachChild(text, blockBounds(text, item.start), (c) => {
    if (c.isBlock && c.key.toLowerCase() === 'visuals') visuals = text.slice(c.start, c.end);
  });
  const styled = visuals ? withStyle(visuals, styleOf(effectKey(effectIds))) : null;
  const swaps = new Map<string, string>();
  if (styled) {
    eachChild(styled.visuals, blockBounds(styled.visuals, 0), (c) => {
      if (!c.isBlock || !/^asset_modifier\d*$/i.test(c.key)) return;
      const f = new Map<string, string>();
      eachChild(styled.visuals, c.body, (x) => { if (!x.isBlock) f.set(x.key.toLowerCase(), x.value); });
      const style = f.get('style');
      if ((f.get('type') || '').toLowerCase() === 'model' && f.get('asset') && f.get('modifier') && (!style || style === '0')) {
        swaps.set(normalizeAssetPath(f.get('asset')), normalizeAssetPath(f.get('modifier')));
      }
    });
  }
  return { model: normalizeAssetPath(styled?.model || itemFields(text, item).get('model_player')), swaps };
}

/**
 * Each pick's refit: the model another pick makes of the one it wears. Not its own swaps: an item
 * that refits its own model does it for another body than the one it brings.
 */
export function refitsOf<K>(picks: Map<K, PickModels>): Map<K, string> {
  const out = new Map<K, string>();
  for (const [key, own] of picks) {
    if (!own.model) continue;
    for (const [other, theirs] of picks) {
      const refit = other !== key && theirs.swaps.get(own.model);
      if (refit) { out.set(key, refit); break; }
    }
  }
  return out;
}

/**
 * A pick's own model keeps its stock path: another pick's file at that path is taken out of that
 * pick. The arcana's refit of the stock bracers is for when no bracers are picked.
 * @param picks  each pick's patch, and the stock path its own model goes under as entryPath writes it
 */
export function ownModelsWin(picks: { patch: { assets?: VpkEntry[] }; own: string | null }[]): void {
  const owned = new Set(picks.flatMap((p) => (p.own ? [p.own] : [])));
  if (!owned.size) return;
  for (const { patch, own } of picks) {
    patch.assets = patch.assets?.filter((e) => { const at = entryPath(e).toLowerCase(); return at === own || !owned.has(at); });
  }
}

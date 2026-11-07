/* What a pick in an ability effects slot writes (src/item-builder-ability-fx.ts says what the slots
 * are): the stock item of the slot, with the marked modifiers of the item picked, and the files
 * they need under the plain paths. The item's model, and every modifier the slot does not take,
 * stay out: that is what the slot is for. */
import { t } from './i18n.ts';
import { findItem, listItems } from './schema.ts';
import { effectKey, itemVisuals, setVisualsBlock, withoutFileSwaps } from './item-builder.ts';
import { itemAssets, normalizeAssetPath, type ItemAssets, type SummonModels } from './item-builder-assets.ts';
import { itemHeroes } from './item-builder-slots.ts';
import { styleOf, withStyle } from './item-builder-styles.ts';
import { fxTarget, fxVisuals, hasModifiers } from './item-builder-ability-fx.ts';

/**
 * The block of ability effects slot `n` with what `itemId` gives it, in the style its key names.
 * Shaped as item-builder.ts itemEffectPatch answers, with no model of its own.
 * @param summon  the plain models of the hero's summons, for an effect that swaps one (Techies' mines)
 * @throws when the item or the slot's stock item is not in the table, or the item gives the slot nothing
 */
export function abilityFxPatch(baseText: string, itemId: string | number, effectIds: string | string[] | null | undefined, n: number, summon?: SummonModels): { id: string; block: string; own: null; added: string[]; unplaced: false } & ItemAssets {
  const source = findItem(baseText, itemId);
  if (!source) throw new Error(t('items_game: предмет {0} не найден', itemId));
  const target = fxTarget(listItems(baseText), n);
  if (!target) throw new Error(t('items_game: default_item для предмета {0} не найден', itemId));
  const styled = withStyle(itemVisuals(baseText, source) || '"visuals"\r\n{\r\n}', styleOf(effectKey(effectIds)));
  let visuals = fxVisuals(styled.visuals, n);
  if (!hasModifiers(visuals)) throw new Error(t('У предмета {0} нет эффектов для этой способности', itemId));
  const assets = itemAssets(baseText, visuals, itemHeroes(baseText, source), summon);
  // a summon's model under its unit's path, as for any pick (item-builder.ts withoutFileSwaps says why)
  const units = new Set(assets.assetCopies.flatMap((c) => ('hero' in c ? [c.hero] : 'unit' in c ? [c.unit] : [])));
  const stock = new Set(assets.assetCopies.flatMap((c) => ('to' in c ? [normalizeAssetPath(c.to)] : [])));
  visuals = withoutFileSwaps(visuals, units, stock);
  const block = setVisualsBlock(baseText.slice(target.start, target.end), visuals);
  return { id: target.id, block, own: null, added: [], unplaced: false, ...assets };
}

import * as schema from './schema.ts';
import * as itemBuilder from './item-builder.ts';
import { t } from './i18n.ts';

export function createReplacementValidator(text: string) {
  let wearableTargets: Map<string, Set<string>> | null = null;
  let freeTargets: Set<string> | null = null;
  return (slot: string, itemId: string, targetItemId: unknown): string => {
    if (targetItemId === undefined) return '';
    if (typeof targetItemId !== 'string') {
      throw new Error(t('Предмет {0} нельзя заменить предметом {1} в этом слоте', itemId, String(targetItemId)));
    }
    if (!targetItemId) return '';
    let options: Set<string> | undefined;
    if (slot === 'items') {
      freeTargets ||= new Set(schema.cosmeticOptions(text, slot).map((option) => option.id));
      options = freeTargets;
    } else if (slot.startsWith('item:')) {
      wearableTargets ||= new Map(itemBuilder.itemSlots(text)
        .filter((itemSlot) => !itemSlot.persona && !itemSlot.abilityFx)
        .map((itemSlot) => [itemSlot.slot, new Set(itemSlot.options.map((option) => option.id))] as const));
      options = wearableTargets.get(slot);
    }
    if (!options?.has(itemId) || !options.has(targetItemId) || itemId === targetItemId) {
      throw new Error(t('Предмет {0} нельзя заменить предметом {1} в этом слоте', itemId, targetItemId));
    }
    return targetItemId;
  };
}

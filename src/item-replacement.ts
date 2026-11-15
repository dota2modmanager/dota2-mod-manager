/* Validate a picked item replacing another item in the same game slot. */
import * as schema from './schema.ts';
import * as itemBuilder from './item-builder.ts';
import type { ItemSlot } from './item-builder.ts';
import { t } from './i18n.ts';

/** Validate a saved target for a picked item and return the validated target id. */
export type ReplacementValidator = (slot: string, itemId: string, targetItemId: unknown) => string;

/** Build a validator, optionally reusing wearable slots already read by a pausing walk. */
export function createReplacementValidator(text: string, listedSlots?: readonly ItemSlot[]): ReplacementValidator {
  let wearableTargets: Map<string, Set<string>> | null = null;
  let freeTargets: Set<string> | null = null;
  return (slot: string, itemId: string, targetItemId: unknown): string => {
    if (targetItemId === undefined) return '';
    if (typeof targetItemId !== 'string') {
      throw new Error(t('Предметом {0} нельзя заменить предмет {1} в этом слоте', itemId, String(targetItemId)));
    }
    if (!targetItemId) return '';
    let options: Set<string> | undefined;
    if (slot === 'items') {
      freeTargets ||= new Set(schema.cosmeticOptions(text, slot).map((option) => option.id));
      options = freeTargets;
    } else if (slot.startsWith('item:')) {
      wearableTargets ||= new Map((listedSlots ?? itemBuilder.itemSlots(text))
        .filter((itemSlot) => !itemSlot.persona && !itemSlot.abilityFx)
        .map((itemSlot) => [itemSlot.slot, new Set(itemSlot.options.map((option) => option.id))] as const));
      options = wearableTargets.get(slot);
    }
    if (!options?.has(itemId) || !options.has(targetItemId) || itemId === targetItemId) {
      throw new Error(t('Предметом {0} нельзя заменить предмет {1} в этом слоте', itemId, targetItemId));
    }
    return targetItemId;
  };
}

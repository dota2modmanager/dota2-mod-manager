/* A hero's saved looks in the item builder (issue #527): what the hero wears, kept under a name
 * and put back on in one click. They live in the settings under itemLooks, apart from presets:
 * a preset is the whole app, a look is one hero. Putting one on is src/schema-cosmetics.ts wearLook. */
import { state } from '../core/store.ts';
import { pickedIn } from '../core/installed.ts';
import type { CosmeticSlot, ItemLook, LookPick } from '../catalog/types.ts';

/** The prefix every slot of a hero carries, "item:axe:": what a look is filed under. */
export const heroKey = (slots: CosmeticSlot[]): string => {
  const slot = slots[0]?.slot || '';
  return slot.slice(0, slot.lastIndexOf(':') + 1);
};

/** The hero's looks, the newest last. */
export const looksOf = (key: string): ItemLook[] => (state.settings?.itemLooks || []).filter((l) => l.hero === key);

/** What the hero wears now, pick by pick. */
export function wornPicks(slots: CosmeticSlot[]): LookPick[] {
  return slots.flatMap((s) => {
    const p = pickedIn(s.slot);
    return p?.itemId ? [{ slot: s.slot, itemId: p.itemId, name: p.name || p.itemId, ...(p.effectId ? { effectId: p.effectId } : {}) }] : [];
  });
}

const samePick = (a: LookPick, b: LookPick): boolean => a.slot === b.slot && a.itemId === b.itemId && (a.effectId || '') === (b.effectId || '');

/** The hero wears exactly this look: its picks, and nothing else of the builder's. */
export function lookIsOn(look: ItemLook, slots: CosmeticSlot[]): boolean {
  const worn = wornPicks(slots);
  return worn.length === look.picks.length && look.picks.every((p) => worn.some((w) => samePick(p, w)));
}

async function store(list: ItemLook[]): Promise<void> {
  state.settings = await window.api.settings.set('itemLooks', list);
}

const all = (): ItemLook[] => state.settings?.itemLooks || [];

export const saveLook = (hero: string, name: string, picks: LookPick[]): Promise<void> =>
  store([...all(), { id: `look-${Date.now().toString(36)}`, hero, name, picks, at: Date.now() }]);

export const renameLook = (id: string, name: string): Promise<void> => store(all().map((l) => (l.id === id ? { ...l, name } : l)));

export const deleteLook = (id: string): Promise<void> => store(all().filter((l) => l.id !== id));

/* "Что внутри" for a preset card, own or published: the sorting is presets/inside.ts, this gives it
 * the catalog's names and glyphs and each thing its picture. */
import { catName, catIcon } from '../../core/categories.ts';
import { COSMETIC_PREFIX } from '../../core/constants.ts';
import { cosmeticName } from '../../ui/cosmetic-name.ts';
import { sortInside, type InsideEntry } from '../../presets/inside.ts';
import type { InsideItem, InsideModel } from '../../presets/model.ts';

/** A look that is not a hero's item, under the catalog's own name for its slot. */
export const lookGroup = (slot: string) => COSMETIC_PREFIX + (slot.startsWith('item:') ? 'items' : slot);

/** Where a hero's item goes, said in the window's language. */
function slotLabel(slot: string): string {
  const labels: Record<string, string> = {
    head: L`Голова`, hair: L`Волосы`, helmet: L`Шлем`, neck: L`Шея`, shoulder: L`Плечи`, shoulders: L`Плечи`,
    arms: L`Руки`, arm: L`Рука`, armor: L`Броня`, back: L`Спина`, belt: L`Пояс`, weapon: L`Оружие`,
    offhand: L`Вторая рука`, off_hand: L`Вторая рука`, shield: L`Щит`, legs: L`Ноги`, tail: L`Хвост`,
    mount: L`Ездовое`, ambient: L`Эффект`, misc: L`Разное`, persona_selector: L`Персона`,
  };
  return labels[slot] || slot.replace(/_/g, ' ');
}

/** A look's entry, its picture fetched by the item's name as My mods asks for it. */
export const lookEntry = (slot: string, name: string, absent = false): InsideEntry<InsideItem> => ({
  kind: 'look', slot, data: { name: cosmeticName(name), thumb: { key: name, icon: catIcon(lookGroup(slot)) }, absent },
});

export function insideModel(entries: InsideEntry<InsideItem>[]): InsideModel {
  const s = sortInside(entries, lookGroup);
  return {
    groups: s.groups.map((g) => ({ id: g.id, icon: catIcon(g.id), name: catName(g.id), n: g.entries.length, items: g.entries })),
    heroes: s.heroes.map((h) => ({ hero: h.hero, items: h.entries.map((e) => ({ ...e.data, hint: slotLabel(e.slot) })) })),
  };
}

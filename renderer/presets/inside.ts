/* What a preset holds, sorted for reading: catalog mods by their category, a hero's items under
 * that hero in the order they sit on the body, and any other look from the game by its slot.
 * A preset of two hundred items read as one line of names was a wall nobody could find their hero
 * in; under the hero's name and picture, it is a few rows to scan. Drawn by PresetInside.tsx. */

/** One thing in a preset, as the screen hands it over. */
export type InsideEntry<T> =
  | { kind: 'mod'; categoryId: string; data: T }
  | { kind: 'look'; slot: string; data: T };

export interface Sorted<T> {
  /** catalog categories and non-item looks, biggest first */
  groups: { id: string; entries: T[] }[];
  /** heroes by the number of their items, then by token */
  heroes: { hero: string; entries: { slot: string; data: T }[] }[];
}

/** Where an item sits on the body, top to bottom; anything else after, by name. */
const BODY = ['head', 'hair', 'helmet', 'neck', 'shoulder', 'shoulders', 'arms', 'arm', 'armor', 'back', 'belt',
  'weapon', 'offhand', 'off_hand', 'shield', 'legs', 'tail', 'mount', 'ambient', 'misc', 'persona_selector'];
const place = (slot: string) => {
  const i = BODY.indexOf(slot);
  return i < 0 ? BODY.length : i;
};

/** `item:<hero>:<slot>` split, or null for a look that is not a hero's item. */
export function heroItem(slot: string): { hero: string; slot: string } | null {
  const m = /^item:([a-z0-9_]+):(.+)$/.exec(slot);
  return m ? { hero: m[1], slot: m[2] } : null;
}

export function sortInside<T>(entries: InsideEntry<T>[], lookGroup: (slot: string) => string): Sorted<T> {
  const groups = new Map<string, T[]>();
  const heroes = new Map<string, { slot: string; data: T }[]>();
  for (const e of entries) {
    if (e.kind === 'look') {
      const item = heroItem(e.slot);
      if (item) {
        heroes.set(item.hero, [...(heroes.get(item.hero) || []), { slot: item.slot, data: e.data }]);
        continue;
      }
    }
    const id = e.kind === 'mod' ? e.categoryId || 'other' : lookGroup(e.slot);
    groups.set(id, [...(groups.get(id) || []), e.data]);
  }
  return {
    groups: [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([id, list]) => ({ id, entries: list })),
    heroes: [...heroes.entries()]
      .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
      .map(([hero, list]) => ({ hero, entries: [...list].sort((a, b) => place(a.slot) - place(b.slot) || (a.slot < b.slot ? -1 : 1)) })),
  };
}

/** A hero's token as a name, until the game's own name for it arrives: earth_spirit → Earth Spirit. */
export const tokenName = (hero: string) => hero.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

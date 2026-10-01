/* Which look of a mod a card is showing, and whether it is installed.
 *
 * A look is picked on the card itself, because that is where the question comes up: scrolling
 * past a mod in three colours, the one you want to see is not always the one the catalog lists
 * first, and opening the window to find out is a detour. The site this catalog comes from works
 * the same way and keeps the choice; here it lasts the session, which is as long as a grid does. */
import type { Mod, ModStyle } from './types.ts';
import { state } from '../core/store.js';
import { keyOf } from '../core/keys.js';

const picked = new Map<string, number>(); // "cat|name" -> index
const lookKey = (cat: string, name: string): string => `${cat}|${name}`;

export function styleIndex(cat: string, mod: Mod): number {
  const i = picked.get(lookKey(cat, mod.name)) || 0;
  return mod.styles && i < mod.styles.length ? i : 0;
}

/** The look the card is standing on: its own file, picture and name inside the catalog. */
export function shownStyle(cat: string, mod: Mod): ModStyle | null {
  return mod.styles ? mod.styles[styleIndex(cat, mod)] ?? null : null;
}

export function pickStyle(cat: string, mod: Mod, index: number): void {
  picked.set(lookKey(cat, mod.name), index);
}

/** Whether any look of the mod is installed. */
export function isInstalled(cat: string, m: Mod): boolean {
  return state.installedIndex.has(keyOf(cat, m.name, null)) ||
    (m.styles || []).some((s) => state.installedIndex.has(keyOf(cat, m.name, s.label)));
}

/** Whether the look on show is installed: the card's badge answers for that, not for the mod. */
export function lookInstalled(cat: string, m: Mod): boolean {
  const style = shownStyle(cat, m);
  return style ? state.installedIndex.has(keyOf(cat, m.name, style.label)) : isInstalled(cat, m);
}

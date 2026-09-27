/* Which mods can go in the install list (ui/queue.js), and what the list is told about one. */
import type { Mod } from './types.ts';
import { catalogConstants } from './data.ts';
import { keyOf } from '../core/keys.js';
import { catName } from '../core/categories.js';
import { previewUrl } from '../ui/media.js';
import { canBeInstalled } from './mods.ts';
import { shownStyle } from './looks.ts';

export interface QueueEntry {
  key: string;
  cat: string;
  catName: string;
  name: string;
  label: string | null;
  title: string;
  file: string | undefined;
  preview: string | null;
}

/* Guides and tools are not mods, a pack is a list already, and two categories only allow a
 * handful of theirs - all of which the catalog says itself in addToCartRules, the same rules its
 * own site follows. */
export function canQueue(cat: string, mod: Mod): boolean {
  const rules = catalogConstants().addToCartRules || {};
  if ((rules.hiddenCategories || []).includes(cat)) return false;
  if (mod.type === 'guide' || mod.type === 'pack') return false;
  const allowed: unknown[] | undefined = rules.allowedMods?.[cat];
  if (allowed && !allowed.some((n) => String(n).toLowerCase() === mod.name.toLowerCase())) return false;
  return canBeInstalled(mod);
}

/** What the list needs to know about a mod: the look on show, not the mod in general. */
export function queueEntry(cat: string, mod: Mod): QueueEntry {
  const style = shownStyle(cat, mod);
  return {
    key: keyOf(cat, mod.name, style?.label || null),
    cat,
    catName: catName(cat),
    name: mod.name,
    label: style?.label || null,
    title: style?.label ? `${mod.name} · ${style.label}` : mod.name,
    file: style?.file || mod.file,
    preview: previewUrl(cat, style?.preview || mod.preview),
  };
}

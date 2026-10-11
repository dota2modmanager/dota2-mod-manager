/* What to call a category and what to draw next to it.
 *
 * Three sources answer to one name here: the built-in table, a cosmetic slot read live from
 * the game's own schema, and whatever the catalog's translation file adds. Screens should
 * not have to know which of the three a given id came from.
 */
import { state } from './store.ts';
import { CAT_RU, CAT_ICON, COSMETIC_PREFIX, cosmeticMeta } from './constants.ts';
import { catalogLabel } from '../ui/catalog-name.ts';
import { heroName } from '../ui/hero-name.ts';

const cosmeticSlot = (slot: string) => (state.cosmeticSlots || []).find((s) => s.slot === slot) || null;

export function catName(id: string): string {
  if (id === 'all') return tr('Все категории');
  if (id.startsWith(COSMETIC_PREFIX)) {
    const slot = id.slice(COSMETIC_PREFIX.length);
    return heroName(cosmeticSlot(slot)?.label || tr(cosmeticMeta(slot).label));
  }
  return catalogLabel(tr(CAT_RU[id]) || state.catalog?.constants?.translations?.[id] || id);
}

export function catIcon(id: string): string {
  if (id.startsWith(COSMETIC_PREFIX)) {
    const slot = id.slice(COSMETIC_PREFIX.length);
    return cosmeticSlot(slot)?.icon || cosmeticMeta(slot).icon;
  }
  return CAT_ICON[id] || 'extension';
}

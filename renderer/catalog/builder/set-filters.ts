/* The item builder's sets window narrowed and sorted (issue #526): by name, newest, oldest or
 * rarest, and by rarity, release year, event and having styles. What a set carries is
 * src/item-builder-details.ts; the window is catalog/builder/SetsModal.tsx. */
import type { CosmeticSet } from '../types.ts';

export interface SetFilters {
  sort: 'name' | 'new' | 'old' | 'rare';
  /** a rarity key, '' for any */
  rarity: string;
  /** release years, '' for open */
  from: string;
  to: string;
  /** an event's id, '' for any: its name is the game's in the player's language, and changes with it */
  event: string;
  /** only sets with more than one style */
  styled: boolean;
}

export const SET_FILTERS: SetFilters = { sort: 'name', rarity: '', from: '', to: '', event: '', styled: false };

/** The game's rarities, commonest first (items_game "rarities", by value). */
export const RARITIES = ['common', 'uncommon', 'rare', 'mythical', 'legendary', 'ancient', 'immortal', 'arcana', 'seasonal'];

const rank = (s: CosmeticSet): number => RARITIES.indexOf(s.rarity || '');
const year = (s: CosmeticSet): string => (s.date || '').slice(0, 4);
const label = (s: CosmeticSet): string => s.title || s.name;

/** The sets the filters leave, in the order asked for. */
export function filterSets(sets: CosmeticSet[], f: SetFilters): CosmeticSet[] {
  const out = sets.filter((s) => (!f.rarity || s.rarity === f.rarity)
    && (!f.from || (year(s) && year(s) >= f.from))
    && (!f.to || (year(s) && year(s) <= f.to))
    && (!f.event || s.event === f.event)
    && (!f.styled || (s.styles || 1) > 1));
  const byName = (a: CosmeticSet, b: CosmeticSet) => label(a).localeCompare(label(b));
  const byDate = (a: CosmeticSet, b: CosmeticSet) => (a.date || '').localeCompare(b.date || '');
  if (f.sort === 'new') return out.sort((a, b) => byDate(b, a) || byName(a, b));
  if (f.sort === 'old') return out.sort((a, b) => (!a.date ? 1 : !b.date ? -1 : byDate(a, b)) || byName(a, b));
  if (f.sort === 'rare') return out.sort((a, b) => rank(b) - rank(a) || byName(a, b));
  return out.sort(byName);
}

/** What the hero's sets have to choose from: the rarities in order, the years, the events by id with their names, in the order of the names. */
export function setFacets(sets: CosmeticSet[]): { rarities: { value: string; label: string }[]; years: string[]; events: { value: string; label: string }[] } {
  const rarities = new Map<string, string>();
  const events = new Map<string, string>();
  for (const s of sets) {
    if (s.rarity) rarities.set(s.rarity, s.rarityName || s.rarity);
    if (s.event && s.eventName) events.set(s.event, s.eventName);
  }
  return {
    rarities: [...rarities].sort((a, b) => RARITIES.indexOf(a[0]) - RARITIES.indexOf(b[0])).map(([value, l]) => ({ value, label: l })),
    years: [...new Set(sets.map(year).filter(Boolean))].sort(),
    events: [...events].map(([value, l]) => ({ value, label: l })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** How many filters narrow the list, for the reset button. */
export const activeFilters = (f: SetFilters): number => [f.rarity, f.from, f.to, f.event].filter(Boolean).length + (f.styled ? 1 : 0);

const KEY = 'mm-set-filters';

/** The filters as the window last left them, kept like the catalog's toolbar; a store that fails gives the defaults. */
export function readSetFilters(store: Pick<Storage, 'getItem'> | null): SetFilters {
  try {
    const got = JSON.parse(store?.getItem(KEY) || '{}');
    const f = { ...SET_FILTERS };
    if (['name', 'new', 'old', 'rare'].includes(got.sort)) f.sort = got.sort;
    for (const k of ['rarity', 'from', 'to'] as const) if (typeof got[k] === 'string') f[k] = got[k];
    // an event kept by its name, as the window did while it spelled every id out, would match no set now
    if (typeof got.event === 'string' && /^EVENT_ID_/.test(got.event)) f.event = got.event;
    f.styled = got.styled === true;
    return f;
  } catch {
    return { ...SET_FILTERS };
  }
}

export function writeSetFilters(store: Pick<Storage, 'setItem'> | null, f: SetFilters): void {
  try { store?.setItem(KEY, JSON.stringify(f)); } catch { /* private window: kept for this run only */ }
}

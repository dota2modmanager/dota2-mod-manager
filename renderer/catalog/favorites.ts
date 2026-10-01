/* Starred mods and looks, kept in settings as "<categoryId>|<name>" keys (state.favorites). */
import { state } from '../core/store.js';

export const favKey = (cat: string, name: string): string => `${cat}|${name}`;
export const isFav = (cat: string, name: string): boolean => state.favorites.has(favKey(cat, name));

/** Flips a star and saves it; returns whether it is on now. */
export async function toggleFavorite(cat: string, name: string): Promise<boolean> {
  const key = favKey(cat, name);
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.add(key);
  state.settings = await window.api.settings.set('favorites', [...state.favorites]);
  return state.favorites.has(key);
}

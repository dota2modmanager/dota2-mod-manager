/* Tags in the catalog answer two different questions, and only one of them is a filter you
 * flip. "What does this mod change" - effects, icons, sounds - can be true at once and stays a
 * chip. The rest of hero-items names the slot the item sits in: one answer at a time out of
 * fourteen, which as chips was a second toolbar under the first, six of them finding one mod
 * each. Heroes are already a dropdown for the same reason. */
import type { Mod } from './types.ts';
import { catalogLabel } from '../ui/catalog-name.ts';

export const SLOT_TAGS = new Set(['weapon', 'shoulders', 'head', 'arms', 'arm', 'armor', 'back', 'mount', 'shield', 'totem', 'hair']);

// the catalog spells one slot both ways
const TAG_ALIAS: Record<string, string> = { arm: 'arms' };
export const canonTag = (t: string): string => TAG_ALIAS[t] || t;

/* Our own words for what the catalog ships in English. Keys are Russian, like everywhere else in
 * the app, so tr() carries them into English by the same table as the rest. */
const TAG_WORD: Record<string, string> = {
  effects: 'Эффекты', icons: 'Иконки', sounds: 'Звуки', anime: 'Аниме', adult: '18+',
  video: 'Видео', image: 'Картинка', lowres: 'Плохое качество',
  meta: 'Мета', stats: 'Статистика', fun: 'Развлечения', 'source-code': 'Исходный код',
  weapon: 'Оружие', shoulders: 'Наплечники', head: 'Голова', arms: 'Руки', armor: 'Броня',
  back: 'Спина', mount: 'Ездовое', shield: 'Щит', totem: 'Тотем', hair: 'Волосы',
};

/**
 * The word a user reads for a tag. A tag we have never seen gets the catalog's own label for it
 * if there is one, else the raw key, and either way it starts with a capital rather than looking
 * like a leftover id.
 */
export function tagLabel(tag: string, catalogLabels?: Record<string, string>): string {
  const known = TAG_WORD[canonTag(tag)];
  if (known) return tr(known);
  const raw = String(catalogLabels?.[tag] || tag);
  return catalogLabel(raw.charAt(0).toUpperCase() + raw.slice(1));
}

/** The tags a mod actually carries, each slot spelled one way. */
export function modTags(m: Mod): string[] {
  return [...new Set(Object.entries(m.tags || {}).filter(([, v]) => v).map(([k]) => canonTag(k)))];
}

/* Chips: what the mod changes, commonest first. A chip that finds one mod today is kept - the
 * catalog grows, and "which courier has effects" is worth asking even of a list of one. */
export function collectTags(mods: Mod[]): string[] {
  const tags = new Map<string, number>();
  for (const m of mods) {
    for (const [k, v] of Object.entries(m.tags || {})) {
      if (v && !SLOT_TAGS.has(k)) tags.set(k, (tags.get(k) || 0) + 1);
    }
  }
  return [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

/** The dropdown beside the chips: which slot the item goes in, A-Z by the word the user reads. */
export function collectSlots(mods: Mod[], label: (tag: string) => string): string[] {
  const seen = new Set<string>();
  for (const m of mods) {
    for (const [k, v] of Object.entries(m.tags || {})) {
      if (v && SLOT_TAGS.has(k)) seen.add(canonTag(k));
    }
  }
  return [...seen].sort((a, b) => label(a).localeCompare(label(b)));
}

/** The groups a grouped category's mods sit in, in the order the catalog has them. */
export function collectGroups(mods: Mod[]): string[] {
  const seen = new Set<string>();
  for (const m of mods) if (m._group) seen.add(m._group);
  return [...seen];
}

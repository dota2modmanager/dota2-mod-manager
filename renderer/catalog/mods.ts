/* A category's mods, read out of the catalog's data. Pure: the data and the user's own packs are
 * handed in, so the screen and the tests read a category the same way. */
import type { CategoryData, Mod } from './types.ts';

/** A pack the user made (kept in the window's storage by the catalog screen). */
export interface CustomPack {
  name: string;
  mods: unknown[];
}

interface ModsOptions {
  /** tools the catalog lists that this app does the job of itself (core/constants.ts TOOLS_HIDDEN) */
  toolsHidden?: RegExp[];
  /** the user's own packs, listed after the catalog's in 'packs' */
  customPacks?: CustomPack[];
}

/** Every mod of a category, flat, each carrying the group it came from (or null). */
export function modsOf(data: CategoryData | undefined, categoryId: string, opts: ModsOptions = {}): Mod[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    const hidden = opts.toolsHidden || [];
    const mods: Mod[] = data
      .filter((m) => categoryId !== 'tools' || !hidden.some((re) => re.test(m.name || '')))
      .map((m) => ({ ...m, _group: null }));
    if (categoryId === 'packs') {
      for (const p of opts.customPacks || []) mods.push({ name: p.name, type: 'pack', mods: p.mods, _group: null, _custom: true });
    }
    return mods;
  }
  const out: Mod[] = [];
  for (const g of data.groups || []) {
    for (const m of g.mods || []) out.push({ ...m, _group: g.name, _groupId: g.id });
  }
  return out;
}

/** Whether a category's data comes in groups (hero items by hero, creeps by kind). */
export const isGrouped = (data: CategoryData | undefined): boolean => Boolean(data && !Array.isArray(data) && data.groups);

const ARCHIVE = /\.(vpk|zip)$/i;

/** The file an install downloads, when the mod is one (guides and sites are links only). */
export function installTarget(mod: Mod): string | null {
  return mod.file && ARCHIVE.test(mod.file) ? mod.file : null;
}

/** Whether a mod can ever carry the "installed" badge, through its own file or a style's. */
export function canBeInstalled(mod: Mod): boolean {
  return Boolean(installTarget(mod)) || (mod.styles || []).some((s) => Boolean(s.file && ARCHIVE.test(s.file)));
}

/** Every archive and every name a category lists, its styles' files included. */
export type CatalogListing = Map<string, { files: Set<string>; names: Set<string> }>;

/** What each category of mods.json lists, to tell an installed mod the catalog has dropped. */
export function catalogListing(modsData: Record<string, CategoryData | undefined> | null | undefined): CatalogListing {
  const out: CatalogListing = new Map();
  for (const [categoryId, data] of Object.entries(modsData || {})) {
    if (!data) continue;
    const entry = { files: new Set<string>(), names: new Set<string>() };
    for (const m of modsOf(data, categoryId)) {
      if (m.name) entry.names.add(m.name.toLowerCase());
      if (m.file) entry.files.add(m.file);
      for (const s of m.styles || []) if (s.file) entry.files.add(s.file);
    }
    out.set(categoryId, entry);
  }
  return out;
}

/**
 * A mod installed from the catalog that the catalog no longer lists, by file or by name.
 * People asked where a mod went once its author took it down (Darkness's skins), and one taken
 * down for a black screen in matches stayed in the game folder of everybody who had it.
 * Only a category the catalog still has can say a mod is gone from it: a category missing
 * from a half-read catalog says nothing. A pack, a pick, an import or a link has no catalog file.
 */
export function delistedFrom(listing: CatalogListing, rec: { categoryId: string; name: string; fileRef?: string | null; kind?: string }): boolean {
  const ref = rec.fileRef;
  if (!ref || /^https?:\/\//i.test(ref) || rec.kind === 'pack') return false;
  const cat = listing.get(rec.categoryId);
  if (!cat || !cat.files.size) return false;
  return !cat.files.has(ref) && !cat.names.has(String(rec.name || '').toLowerCase());
}

/** Name (lower case) -> where the mod is, across every category: what installed mods are matched by. */
export function modIndexOf(categories: { id: string }[], modsIn: (categoryId: string) => Mod[]): Map<string, { categoryId: string; mod: Mod }> {
  const index = new Map<string, { categoryId: string; mod: Mod }>();
  for (const c of categories) {
    for (const m of modsIn(c.id)) if (m.name) index.set(m.name.toLowerCase(), { categoryId: c.id, mod: m });
  }
  return index;
}

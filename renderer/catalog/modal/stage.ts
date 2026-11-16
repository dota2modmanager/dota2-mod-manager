/* Which catalog mods the mod window shows in 3D, and on what: a hero's or a hero item's, on the
 * hero in the game's own items; a mod of the world's (a ward, a creep, a tower...), its models alone;
 * a river mod, the map's own 3D view over the river.
 * The main process downloads the mod as an install would and reads its files before the game's
 * (crates/mm-core/src/models/mod_look.rs, mod_props.rs). */
import type { PreviewSlot } from '../../api/preview3d.ts';
import type { CosmeticSlot, Mod } from '../types.ts';

/** The categories whose mods are a hero or a hero's item. */
export const STAGED: readonly string[] = ['heroes', 'hero-items'];

/** The categories whose mods are models of the world, shown alone (mod_props.rs PROPS). */
export const PROPS_STAGED: readonly string[] = ['wards', 'creeps', 'towers', 'roshan', 'ancient', 'tormentor', 'couriers', 'pedestal', 'trees'];

/** What the stage asks for: the mod's archive, and the name that says the hero when its files do not;
 * `props` for a mod of the world. */
export interface ModStage { category: string; file: string; hint: string; props?: boolean; river?: boolean }

/** A mod's stage, or null for one that is no hero's, or that installs from a link. */
export function modStage(categoryId: string, mod: Mod, file: string | null | undefined): ModStage | null {
  const props = PROPS_STAGED.includes(categoryId);
  const river = categoryId === 'river';
  if ((!STAGED.includes(categoryId) && !props && !river) || !file || !/\.(zip|vpk)$/i.test(file) || mod.type === 'pack') return null;
  if (props) return { category: categoryId, file, hint: mod.name, props: true };
  // a river mod is the map's water: the map itself, close over the river
  if (river) return { category: categoryId, file, hint: mod.name, river: true };
  // a hero item sits in its hero's group ("Alchemist"), which names the hero better than the item does
  return { category: categoryId, file, hint: mod._group || mod.name };
}

/** The hero's slots in their stock items, as the item builder's warm-up asks for them. */
export function stockSlots(slots: Pick<CosmeticSlot, 'slot' | 'targetId' | 'heroIds' | 'abilityFx'>[], hero: string): PreviewSlot[] {
  const id = hero.replace(/^npc_dota_hero_/, '');
  return slots
    .filter((s) => s.targetId && !s.abilityFx && s.heroIds?.includes(id))
    .map((s) => ({ slot: s.slot, stock: String(s.targetId) }));
}

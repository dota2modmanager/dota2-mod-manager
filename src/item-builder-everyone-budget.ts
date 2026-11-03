/* How much of everybody's look (src/item-builder-everyone.ts) the game can take, and whose.
 *
 * The look on everybody puts one of the user's models under the path of every other item of a
 * hero's slot, so a big library writes thousands of paths over a few hundred models: 583 picks
 * dressed 9,082 items under 9,706 paths (J0nathan550, 2026-11-03). Past somewhere between 5,462
 * and 6,574 entries in the mod folder's paks, the game started handing out wrong models: Skywrath
 * Mage's Arcane Bolt and Concussive Shot flew with a stranger's hands or chest on them, a
 * different one for a different half of the items (#414). It is the count and not any one file:
 * two halves with no item in common both broke, and either alone at 5,464 entries did not; and it
 * is not the pak, since the same files spread over pak02 to pak05 broke the same way.
 *
 * So the user picks the heroes it is for (none picked: every hero they built), and a hero goes in
 * whole or not at all, in the user's order, else the hero picked most lately first, while the
 * table's whole pak stays under a budget a thousand entries short of the last count seen working.
 * Those left out are said in Settings, so a long list never breaks the game in silence.
 */
import { entryPath, type VpkEntry } from './vpk.ts';
import type { SchemaPatch } from './schema.ts';
import type { EveryonePatch } from './item-builder-everyone.ts';

/** Entries the mod folder's paks may hold with everybody's look in them: 5,462 was seen working. */
export const EVERYONE_ENTRY_BUDGET = 4500;

const key = (en: VpkEntry) => entryPath(en).toLowerCase();

/** The heroes of the user's item builder picks (skywrath_mage), the one picked most lately first. */
export function heroesByRecency(records: { slot?: string; enabled?: boolean; installedAt?: number }[]): string[] {
  const last = new Map<string, number>();
  for (const r of records) {
    const hero = /^item:([^:]+):/.exec(r.slot || '')?.[1];
    if (!hero || r.enabled === false) continue;
    last.set(hero, Math.max(last.get(hero) ?? 0, r.installedAt ?? 0));
  }
  return [...last].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([hero]) => hero);
}

/**
 * Everybody's look as far as the budget goes: whole heroes in `order`, each taken only if the paths
 * it adds fit beside those already in.
 * @param own     the build's own patches and the files beneath them: they are in the pak whatever happens
 * @param order   heroes by id (skywrath_mage), the first the most wanted
 * @returns the patches taken, and the heroes that had something to dress and did not fit
 */
export function withinBudget(patches: EveryonePatch[], own: { patches: SchemaPatch[]; beneath: VpkEntry[] }, order: string[], budget = EVERYONE_ENTRY_BUDGET): { patches: EveryonePatch[]; left: string[] } {
  // the table itself, and every file of the build's own
  const taken = new Set<string>(['scripts/items/items_game.txt']);
  for (const en of [...own.patches.flatMap((p) => p.assets || []), ...own.beneath]) taken.add(key(en));
  const byHero = new Map<string, EveryonePatch[]>();
  for (const p of patches) {
    const hero = p.hero.replace(/^npc_dota_hero_/, '');
    byHero.set(hero, [...(byHero.get(hero) ?? []), p]);
  }
  // a hero with something to dress that the order does not name goes last, in the table's order
  const heroes = [...order.filter((h) => byHero.has(h)), ...[...byHero.keys()].filter((h) => !order.includes(h))];
  const out: EveryonePatch[] = [];
  const left: string[] = [];
  for (const hero of heroes) {
    const mine = byHero.get(hero)!;
    const adds = new Set(mine.flatMap((p) => (p.assets || []).map(key)).filter((k) => !taken.has(k)));
    if (taken.size + adds.size > budget) { left.push(hero); continue; }
    for (const k of adds) taken.add(k);
    out.push(...mine);
  }
  return { patches: out, left };
}

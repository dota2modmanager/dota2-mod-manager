/**
 * Tower looks as a file mod (issue #446). The game has thirteen items that dress the towers: five
 * pairs a player equips per side ("Guardians of the Lost Path Radiant Towers"), offered by the
 * free looks once safe mode is off, and three event items (New Bloom's dragon towers, The
 * International 2017's) nobody can equip any more. Each says in its visuals which model the tower
 * entity wears, which model stands in for each stage of its destruction, and which particles it
 * swaps. Those are files, so a pak can put them under the default tower's names, for one side or
 * both, with safe mode on.
 *
 * What a file cannot carry is left out and said: a particle the item creates (it needs a host),
 * its sounds, the TI7 tower's level activities and skins.
 */
import { itemVisuals, type AssetModifier } from './item-visuals.ts';
import { buildVpk, entryAt, sharedVpkIndex } from './vpk.ts';

export type Side = 'radiant' | 'dire';

/** The model every tower of a side wears. The map's tower entities name it (maps/dota.vpk and hero
 * demo, 2026-11-03), and that wins over npc_units.txt, which says tower_good for Radiant. */
export const DEFAULT_TOWER: Record<Side, string> = {
  radiant: 'models/props_structures/radiant_tower002.vmdl',
  dire: 'models/props_structures/dire_tower002.vmdl',
};

/** One item that dresses the towers, with the sides it has something for. */
export interface TowerLook { id: string; name: string; sides: Side[] }

/** What a look does to one side: files under the default names, and what it leaves out. */
export interface TowerPlan { files: { at: string; from: string }[]; skipped: string[] }

const TOWER_UNIT = /^npc_dota_(goodguys|badguys)_tower/;
const ENTITY = /^entity(_clientside)?_model$/;

/** The side an asset belongs to, by its name: the game names them for Radiant and Dire. */
function sideOf(asset: string): Side | null {
  const m = TOWER_UNIT.exec(asset);
  if (m) return m[1] === 'goodguys' ? 'radiant' : 'dire';
  if (/radiant|_good|good_|goodguys/.test(asset)) return 'radiant';
  if (/dire|_bad|bad_|badguys/.test(asset)) return 'dire';
  return null;
}

/** The ids of the items whose visuals put a model on a tower, in the table's order. */
export function towerLookIds(text: string): string[] {
  const ids: string[] = [];
  const re = /"asset"\s+"npc_dota_(?:goodguys|badguys)_tower\w*"/g;
  const head = /\n\t\t"(\d+)"\s*\{/y;
  for (let m; (m = re.exec(text));) {
    // the item this modifier sits in: the nearest item key before it, two tabs in
    let id = '';
    for (let at = text.lastIndexOf('\n\t\t"', m.index); at > 0 && !id; at = text.lastIndexOf('\n\t\t"', at - 1)) {
      head.lastIndex = at;
      id = head.exec(text)?.[1] || '';
    }
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Every look the table has, with the sides each dresses. */
export function towerLooks(text: string): TowerLook[] {
  return towerLookIds(text).map((id) => {
    const v = itemVisuals(text, id);
    const sides = new Set<Side>();
    for (const m of v?.modifiers || []) if (ENTITY.test(m.type)) { const s = sideOf(m.asset); if (s) sides.add(s); }
    return { id, name: v?.name || id, sides: (['radiant', 'dire'] as Side[]).filter((s) => sides.has(s)) };
  }).filter((l) => l.sides.length);
}

const compiled = (p: string) => `${p.replace(/\.(vmdl|vpcf)$/i, (x) => x.toLowerCase())}_c`;

/** What a look's visuals put under which name for one side. */
export function towerPlan(modifiers: AssetModifier[], side: Side): TowerPlan {
  const files = new Map<string, string>();
  const skipped: string[] = [];
  for (const m of modifiers) {
    if (ENTITY.test(m.type)) {
      // one model for all ten towers of the side: the last one named wins, as they are all the same
      if (sideOf(m.asset) === side && m.modifier) files.set(compiled(DEFAULT_TOWER[side]), compiled(m.modifier));
    } else if (m.type === 'model' || m.type === 'particle' || m.type === 'particle_clientside') {
      if (m.asset && m.modifier && sideOf(m.asset) === side) files.set(compiled(m.asset), compiled(m.modifier));
    } else if ((sideOf(m.asset || m.modifier) ?? side) === side) {
      // named for the other side: that side's pak says it
      skipped.push(`${m.type}${m.modifier ? ` ${m.modifier}` : ''}`);
    }
  }
  return { files: [...files].map(([at, from]) => ({ at, from })), skipped: [...new Set(skipped)] };
}

/** A look for one side or both as one VPK, out of the game's pak01. A file the game lacks is left out and named. */
export function buildTowerLook({ pak01, text, id, sides }: { pak01: string; text: string; id: string; sides: Side[] }): {
  vpk: Buffer; name: string; files: number; missing: string[]; skipped: string[];
} {
  const v = itemVisuals(text, id);
  if (!v) throw new Error(`towers: no item ${id}`);
  const files: TowerPlan['files'] = [];
  const skipped = new Set<string>();
  for (const side of sides) {
    const plan = towerPlan(v.modifiers, side);
    if (!plan.files.some((f) => f.at === compiled(DEFAULT_TOWER[side]))) throw new Error(`towers: ${v.name} has no ${side} tower`);
    files.push(...plan.files);
    for (const s of plan.skipped) skipped.add(s);
  }
  const index = sharedVpkIndex(pak01);
  const entries = [];
  const missing: string[] = [];
  for (const f of files) {
    const data = index.read(f.from);
    if (data) entries.push(entryAt(f.at, data as Buffer));
    else missing.push(f.from);
  }
  return { vpk: buildVpk(entries), name: v.name, files: entries.length, missing, skipped: [...skipped] };
}

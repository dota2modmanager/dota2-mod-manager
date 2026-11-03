/**
 * Trees on the map from another of the game's tree sets, one set for Radiant and one for Dire
 * (issue #421). Trees are entities that name their model by path, and the two sides use models
 * of their own, so a pak that puts other models under the default trees' names changes the trees
 * of one side and leaves the other alone. Counted on the default map (2026-11-03): 1370 Radiant
 * trees in eight models, 1097 Dire trees in four.
 *
 * The sets are the ones the game's terrains use. Autumn, spring and summer reuse the default
 * names, so the pak works there as well; terrains with trees of their own are left as they are.
 */
import { buildVpk, entryAt, sharedVpkIndex } from './vpk.ts';

export type Side = 'radiant' | 'dire';

/** The models each side's trees wear on the default map, the most used first. */
export const DEFAULT_TREES: Record<Side, string[]> = {
  radiant: [
    'models/props_tree/tree_pine_01.vmdl', 'models/props_tree/tree_oak_01b.vmdl', 'models/props_tree/tree_oak_01.vmdl',
    'models/props_tree/tree_oak_02.vmdl', 'models/props_tree/tree_pine_02.vmdl', 'models/props_tree/tree_bamboo_02.vmdl',
    'models/props_tree/tree_pine_03b.vmdl', 'models/props_tree/tree_bamboo_01.vmdl',
  ],
  dire: [
    'models/props_tree/dire_tree004.vmdl', 'models/props_tree/dire_tree004b.vmdl',
    'models/props_tree/dire_tree008.vmdl', 'models/props_tree/dire_tree007.vmdl',
  ],
};

/** One of the game's tree sets, named for the terrain it comes from. */
export interface TreeSet { id: string; name: string; models: string[] }

const tree = (...names: string[]) => names.map((n) => `models/props_tree/${n}.vmdl`);

/** The sets the terrains use, read out of their entity lumps (2026-11-03). The reef's coral trees
 * are left out: they ship inside that map, not in pak01. */
export const TREE_SETS: TreeSet[] = [
  { id: 'radiant', name: 'Radiant', models: DEFAULT_TREES.radiant },
  { id: 'dire', name: 'Dire', models: DEFAULT_TREES.dire },
  { id: 'winter', name: 'Winter', models: tree('tree_pine_01_heavysnow', 'tree_oak_snow_01b', 'tree_oak_snow_01', 'tree_pine_02_heavysnow') },
  { id: 'autumn', name: 'Autumn', models: tree('tree_oak_autumn_01b', 'cornstack/cornstack') },
  { id: 'spring', name: 'Spring', models: tree('tree_oak_spring_01b', 'tree_oak_spring_01') },
  { id: 'desert', name: 'Desert', models: tree('palm_03a', 'palm_03', 'palm_02d', 'palm_02e', 'palm_02b') },
  { id: 'desert-dire', name: 'Desert Dire', models: tree('dire_tree004_tint', 'dire_tree007_tintable') },
  { id: 'jungle', name: 'Jungle', models: tree('palm_02e', 'palm_02b') },
  { id: 'coloseum', name: 'Coloseum', models: tree('olive/tree_oldolive', 'cypress/tree_cypress010', 'cypress/tree_cypress008', 'olive/tree_oldolive2', 'cypress/tree_cypress009') },
  { id: 'topiary', name: 'Topiary', models: tree('topiary/topiary001', 'topiary/topiary002') },
];

const compiled = (p: string) => `${p}_c`;

/** Which file goes under which name: each default model of the side takes the set's models in turn. */
export function treePlan(side: Side, set: TreeSet): { at: string; from: string }[] {
  return DEFAULT_TREES[side].map((at, i) => ({ at: compiled(at), from: compiled(set.models[i % set.models.length]) }))
    .filter((f) => f.at !== f.from);
}

/** A pak with each side's trees from its set, out of the game's pak01; a side left out keeps its trees. */
export function buildTrees({ pak01, radiant, dire }: { pak01: string; radiant?: string | null; dire?: string | null }): {
  vpk: Buffer; files: number; missing: string[];
} {
  const plan: { at: string; from: string }[] = [];
  for (const [side, id] of [['radiant', radiant], ['dire', dire]] as const) {
    if (!id) continue;
    const set = TREE_SETS.find((s) => s.id === id);
    if (!set) throw new Error(`trees: no set "${id}"; the game has ${TREE_SETS.map((s) => s.id).join(', ')}`);
    plan.push(...treePlan(side, set));
  }
  if (!plan.length) throw new Error('trees: pick a set for Radiant or Dire that is not its own');
  const index = sharedVpkIndex(pak01);
  const entries = [];
  const missing: string[] = [];
  for (const f of plan) {
    const data = index.read(f.from);
    if (data) entries.push(entryAt(f.at, data));
    else missing.push(f.from);
  }
  return { vpk: buildVpk(entries), files: entries.length, missing };
}

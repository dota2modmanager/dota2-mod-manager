/* A wearable's model without its cloth, for the item builder's copy of it under a stock path of a
 * hero whose own cloth would drag it behind him.
 *
 * 2191 of the game's 12660 item models carry a cloth simulation (a finite-element model,
 * m_pFeModel in their PHYS block) for their tassels, banners, tails and capes. Copied under the
 * stock item's path, which is how the builder puts a wearable on (src/item-builder.ts), it swings
 * with the hero on Earth Spirit, Slark and Ember Spirit, and trails along the ground behind
 * Centaur while he walks, creeping back once he stands still (2026-11-09, again 2026-11-10 on a
 * build that kept the cloth of his Rout tail and head). So it is the hero, not the item.
 *
 * Centaur's body is the one among the 129 heroes whose own cloth has an m_flLocalForce other than
 * 1: his is 1.5; 99 others have 1 and the rest have no cloth. That share of the hero's movement is
 * what the cloth is carried along by, and under a stock path his wearables' cloth goes with his.
 * 3.7.0 took the cloth out of every copy on every hero, and a player found it gone from Earth
 * Spirit's Jade Reckoning, Slark's Sea Rake's Bridle and Ember's ponytail.
 *
 * So on such a hero a copy goes in with m_pFeModel null and the rest of PHYS as it was, a shape
 * the game loads: 404 of its item models have a PHYS block whose m_pFeModel is null, with the same
 * flags as the ones with cloth. Those parts hang still on their bones instead of swinging, and
 * nothing trails. On every other hero, and under an item's own path, the cloth stays.
 */
import { numberOf, readKv3, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';

function feModel(model: Buffer): { kv: Kv3Block; fe: Kv3Node } | null {
  if (!resourceBlocks(model).some((b) => b.name === 'PHYS')) return null;
  const kv = readKv3(resourceBlock(model, 'PHYS').data);
  const fe = kv.root.kind === 'object' ? kv.root.members.get('m_pFeModel') : undefined;
  return fe?.kind === 'object' ? { kv, fe } : null;
}

/** The model with its cloth simulation taken out; the same buffer when it has none, or cannot be read. */
export function withoutCloth(model: Buffer): Buffer {
  try {
    const found = feModel(model);
    if (!found || found.kv.root.kind !== 'object') return model;
    // null in KV3 is a type alone, which is how the game writes a model with no cloth
    found.kv.root.members.set('m_pFeModel', { kind: 'other', type: 1 });
    return resourceBlock(model, 'PHYS').replace(writeKv3(found.kv));
  } catch {
    // a model this cannot read goes in as it is, cloth and all, rather than not at all
    return model;
  }
}

/** Whether a model carries a cloth simulation. */
export function hasCloth(model: Buffer): boolean {
  try {
    return feModel(model) !== null;
  } catch {
    return false;
  }
}

/**
 * Whether a wearable copied to `to` would trail: a path in models/heroes/<folder>/ whose body,
 * <folder>/<folder>.vmdl_c, drags cloth. Asked once per folder. A folder with its body under
 * another name (Drow's drow_base) is not Centaur's, and its copies keep their cloth.
 */
export function clothDragger(read: (p: string) => Buffer | null): (to: string) => boolean {
  const bodies = new Map<string, boolean>();
  return (to) => {
    const folder = /^models\/heroes\/([^/]+)\//i.exec(to)?.[1]?.toLowerCase();
    if (!folder) return false;
    if (!bodies.has(folder)) bodies.set(folder, dragsCloth(read(`models/heroes/${folder}/${folder}.vmdl_c`)));
    return bodies.get(folder)!;
  };
}

/** Whether a hero's body drags the cloth of the wearables under his stock paths: its own cloth's local force is not 1. */
export function dragsCloth(body: Buffer | null): boolean {
  try {
    const found = body && feModel(body);
    if (!found || found.fe.kind !== 'object') return false;
    const force = found.fe.members.get('m_flLocalForce');
    return force?.kind === 'number' && Math.abs(Number(numberOf(found.kv, force)) - 1) > 1e-3;
  } catch {
    return false;
  }
}

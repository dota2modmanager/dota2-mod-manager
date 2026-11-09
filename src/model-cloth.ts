/* A wearable's model without the cloth that trails, for the item builder's copy of it under a
 * stock path.
 *
 * 2191 of the game's 12660 item models carry a cloth simulation (a finite-element model,
 * m_pFeModel in their PHYS block) for their tassels, banners, tails and capes. Worn as the item
 * they are, the game drives it with the hero. Copied under the stock item's path, which is how the
 * builder puts a wearable on (src/item-builder.ts), some of it stays behind when the hero walks:
 * Centaur in the Rout of the Emerald Marauder dragged his axe and his back banner along the
 * ground behind him, and they crept back only once he stood still (2026-11-09). Why the game
 * simulates it so under a stock path the files do not say.
 *
 * What they do say is which cloth it is. The axe and the banner are the two parts of that set whose
 * m_nDynamicNodeFlags lack 0x800; its tail and head carry it, and nobody saw them trail. 3.7.0 took
 * the cloth out of every copy, and a player found it gone from Earth Spirit's Jade Reckoning,
 * Slark's Sea Rake's Bridle and Ember's Master of the Searing Path ponytail, all three with the bit
 * (2026-11-09). 1453 of the 2191 have it. So only a cloth without it comes out.
 *
 * It comes out as m_pFeModel null with the rest of PHYS as it was, a shape the game loads: 404 of its
 * item models have a PHYS block whose m_pFeModel is null, with the same flags as the ones with
 * cloth. Those parts hang still on their bones instead of swinging, and nothing trails. The model
 * under its own path, the hero's body and the units an item dresses are not touched.
 */
import { numberOf, readKv3, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';

/** The node flag every cloth that stayed with its hero under a stock path carries. */
const HOLDS = 0x800;

function feModel(model: Buffer): { kv: Kv3Block; fe: Kv3Node } | null {
  if (!resourceBlocks(model).some((b) => b.name === 'PHYS')) return null;
  const kv = readKv3(resourceBlock(model, 'PHYS').data);
  const fe = kv.root.kind === 'object' ? kv.root.members.get('m_pFeModel') : undefined;
  return fe?.kind === 'object' ? { kv, fe } : null;
}

/** Whether a model's cloth is the kind that trailed behind the hero under a stock path. */
function trails({ kv, fe }: { kv: Kv3Block; fe: Kv3Node }): boolean {
  const flags = fe.kind === 'object' ? fe.members.get('m_nDynamicNodeFlags') : undefined;
  // a cloth whose flags cannot be read is taken out, which is what every copy got in 3.7.0
  return flags?.kind !== 'number' || (Number(numberOf(kv, flags)) & HOLDS) === 0;
}

/** The model with its cloth taken out if that cloth trails; the same buffer otherwise, or when it cannot be read. */
export function withoutCloth(model: Buffer): Buffer {
  try {
    const found = feModel(model);
    if (!found || !trails(found)) return model;
    const { kv } = found;
    if (kv.root.kind !== 'object') return model;
    // null in KV3 is a type alone, which is how the game writes a model with no cloth
    kv.root.members.set('m_pFeModel', { kind: 'other', type: 1 });
    return resourceBlock(model, 'PHYS').replace(writeKv3(kv));
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

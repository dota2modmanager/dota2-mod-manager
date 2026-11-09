/* A wearable's model without its cloth, for the item builder's copy of it under a stock path.
 *
 * 2191 of the game's 12660 item models carry a cloth simulation (a finite-element model,
 * m_pFeModel in their PHYS block) for their tassels, banners and capes. Worn as the item they
 * are, the game drives it with the hero. Copied under the stock item's path, which is how the
 * builder puts a wearable on (src/item-builder.ts), the cloth stays behind when the hero walks:
 * Centaur in the Rout of the Emerald Marauder dragged his axe and his back banner along the
 * ground behind him, and they crept back only once he stood still (2026-11-09); the parts that
 * trailed are the ones the cloth moves. Why the game simulates it so under a stock path the files
 * do not say. What they do show is a shape it loads: 404 of its item models have a PHYS block
 * whose m_pFeModel is null, with the same flags as the ones with cloth.
 *
 * So the copy goes in with m_pFeModel null and the rest of PHYS as it was: the cloth parts hang
 * still on their bones instead of swinging, and nothing trails. The model under its own path,
 * the hero's body and the units an item dresses are not touched.
 */
import { readKv3 } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';

/** The model with its cloth simulation taken out; the same buffer when it has none, or cannot be read. */
export function withoutCloth(model: Buffer): Buffer {
  try {
    if (!resourceBlocks(model).some((b) => b.name === 'PHYS')) return model;
    const block = resourceBlock(model, 'PHYS');
    const kv = readKv3(block.data);
    const root = kv.root;
    if (root.kind !== 'object' || root.members.get('m_pFeModel')?.kind !== 'object') return model;
    // null in KV3 is a type alone, which is how the game writes a model with no cloth
    root.members.set('m_pFeModel', { kind: 'other', type: 1 });
    return block.replace(writeKv3(kv));
  } catch {
    // a model this cannot read goes in as it is, cloth and all, rather than not at all
    return model;
  }
}

/** Whether a model carries a cloth simulation. */
export function hasCloth(model: Buffer): boolean {
  try {
    if (!resourceBlocks(model).some((b) => b.name === 'PHYS')) return false;
    const root = readKv3(resourceBlock(model, 'PHYS').data).root;
    return root.kind === 'object' && root.members.get('m_pFeModel')?.kind === 'object';
  } catch {
    return false;
  }
}

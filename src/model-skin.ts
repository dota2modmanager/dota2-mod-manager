/**
 * A model with one of its material sets made the one it wears by default.
 *
 * An item can wear its model in another material set ("skin" in its visuals): Collector's Baby
 * Roshan 2018 is the plain alt Baby Roshan's model in set 2, the silver one. A model put under a
 * plain unit's path (src/courier-models.ts) is worn in set 0 online, since the server sets the
 * skin from its own table, where the plain unit has none: the silver courier came out purple.
 *
 * So the meshes draw with the set's materials, matched to set 0's by place (a model's
 * m_materialGroups lists every set in the same order), and set 0 takes the set's list under its
 * own name and place, so that whether the game reads the meshes, the first set or the one named
 * "0", it finds the chosen one. The materials are already among the model's references: every
 * set's are.
 */
import { readKv3, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';

const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const items = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
const text = (n: Kv3Node | undefined) => (n?.kind === 'string' ? n.value : '');

/** Every m_material string under a node, the draw calls' of a mesh. */
function materials(n: Kv3Node, out: Extract<Kv3Node, { kind: 'string' }>[] = []) {
  if (n.kind === 'object') for (const [k, v] of n.members) { if (k === 'm_material' && v.kind === 'string') out.push(v); else materials(v, out); }
  else if (n.kind === 'array') for (const v of n.items) materials(v, out);
  return out;
}

/** `model` wearing material set `skin` by default; null where it has no such set or no mesh of its own to change. */
export function withSkin(model: Buffer, skin: number): Buffer | null {
  if (!skin) return model;
  try {
    const data = readKv3(resourceBlock(model, 'DATA').data);
    const groups = member(data.root, 'm_materialGroups');
    if (groups?.kind !== 'array' || skin >= groups.items.length) return null;
    const plain = items(member(groups.items[0], 'm_materials')).map(text);
    const chosen = items(member(groups.items[skin], 'm_materials')).map(text);
    const swap = new Map<string, string>(plain.map((m, i): [string, string] => [m.toLowerCase(), chosen[i] ?? '']).filter(([m, to]) => !!to && to.toLowerCase() !== m));
    if (!swap.size) return model;

    let out = model;
    let changed = false;
    const meshes = resourceBlocks(model).filter((b) => b.name === 'MDAT').length;
    for (let k = 0; k < meshes; k++) {
      const block = resourceBlock(out, 'MDAT', k);
      let kv;
      try { kv = readKv3(block.data); } catch { continue; } // a mesh of the older binary kind
      let hit = false;
      for (const s of materials(kv.root)) {
        const to = swap.get(s.value.toLowerCase());
        if (to) { s.value = to; hit = true; }
      }
      if (hit) { out = block.replace(writeKv3(kv)); changed = true; }
    }
    // the meshes in files of their own (m_refMeshes) are the plain unit's to everyone else too
    if (!changed) return null;
    const first = groups.items[0];
    const set = member(groups.items[skin], 'm_materials');
    if (first.kind !== 'object' || !set) return null;
    first.members.set('m_materials', set);
    return resourceBlock(out, 'DATA').replace(writeKv3(data));
  } catch {
    return null;
  }
}
